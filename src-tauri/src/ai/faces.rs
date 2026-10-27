//! Gesichter auf Fotos (nur wenn in den Einstellungen eingeschaltet).
//!
//! Das Finden und Beschreiben übernimmt das Helfer-Programm (`slimsort-llm --faces …`), hier wird
//! nur gespeichert: je Foto die Gesichter mit ihren 128 Zahlen. Gleiche Person = ähnliche Zahlen.
//! Alles bleibt auf diesem Computer.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

pub const DETECT: &str = "slimsort-face-detect.onnx";
pub const EMBED: &str = "slimsort-face-embed.onnx";
const DIM: usize = 128;

pub type Key = [u8; 20];

#[derive(Clone)]
pub struct FaceRec {
    pub bbox: [f32; 4],
    /// auf Länge 1 gebracht
    pub emb: Vec<f32>,
}

/// Gesichter je Foto, auf der Platte als Liste: Schlüssel, Anzahl, je Gesicht Kasten + 128 Zahlen
pub struct FaceStore {
    file: PathBuf,
    pub map: HashMap<Key, Vec<FaceRec>>,
}

impl FaceStore {
    pub fn load(file: PathBuf) -> FaceStore {
        let mut map = HashMap::new();
        if let Ok(f) = File::open(&file) {
            let mut r = BufReader::new(f);
            let mut head = [0u8; 21];
            while r.read_exact(&mut head).is_ok() {
                let mut k = [0u8; 20];
                k.copy_from_slice(&head[..20]);
                let n = head[20] as usize;
                let mut buf = vec![0u8; n * (4 + DIM) * 4];
                if r.read_exact(&mut buf).is_err() {
                    break;
                }
                let f: Vec<f32> = buf.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
                let faces = f.chunks_exact(4 + DIM).map(|c| FaceRec { bbox: [c[0], c[1], c[2], c[3]], emb: c[4..].to_vec() }).collect();
                map.insert(k, faces);
            }
        }
        FaceStore { file, map }
    }

    pub fn put(&mut self, k: Key, faces: Vec<FaceRec>) {
        let n = faces.len().min(255);
        let mut rec = Vec::with_capacity(21 + n * (4 + DIM) * 4);
        rec.extend_from_slice(&k);
        rec.push(n as u8);
        for f in faces.iter().take(n) {
            for v in f.bbox.iter().chain(f.emb.iter()) {
                rec.extend_from_slice(&v.to_le_bytes());
            }
        }
        if let Ok(mut fh) = OpenOptions::new().create(true).append(true).open(&self.file) {
            let _ = fh.write_all(&rec);
        }
        self.map.insert(k, faces.into_iter().take(n).collect());
    }
}

struct Proc {
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
}

/// Helfer-Programm im Gesichter-Modus (wird beim ersten Bedarf gestartet)
pub struct FaceProc {
    p: Mutex<Option<Proc>>,
    seq: Mutex<u64>,
}

impl FaceProc {
    pub fn new() -> FaceProc {
        FaceProc { p: Mutex::new(None), seq: Mutex::new(0) }
    }

    pub fn stop(&self) {
        if let Some(mut p) = self.p.lock().unwrap().take() {
            let _ = writeln!(p.stdin, "{}", json!({ "quit": true }));
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }

    /// Gesichter in einem Bild (JPEG/PNG-Datei)
    pub fn detect(&self, helper: &Path, dir: &Path, image: &Path) -> Result<Vec<FaceRec>, String> {
        let mut g = self.p.lock().unwrap();
        if g.as_mut().map_or(true, |p| p.child.try_wait().ok().flatten().is_some()) {
            let mut cmd = Command::new(helper);
            cmd.arg("--faces").arg(dir.join(DETECT)).arg(dir.join(EMBED));
            cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            let mut child = cmd.spawn().map_err(|e| format!("Helfer startet nicht ({e})"))?;
            let stdin = child.stdin.take().ok_or("keine Eingabe")?;
            let mut out = BufReader::new(child.stdout.take().ok_or("keine Ausgabe")?);
            let mut line = String::new();
            out.read_line(&mut line).map_err(|e| e.to_string())?;
            let v: Value = serde_json::from_str(&line).map_err(|_| format!("Helfer: {line}"))?;
            if let Some(f) = v["fatal"].as_str() {
                return Err(f.to_string());
            }
            *g = Some(Proc { child, stdin, out });
        }
        let p = g.as_mut().unwrap();
        let id = {
            let mut s = self.seq.lock().unwrap();
            *s += 1;
            *s
        };
        writeln!(p.stdin, "{}", json!({ "id": id, "image": image.to_string_lossy() })).and_then(|_| p.stdin.flush()).map_err(|e| e.to_string())?;
        loop {
            let mut line = String::new();
            if p.out.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
                *g = None;
                return Err("Helfer beendet".into());
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if v["id"].as_u64() != Some(id) {
                continue;
            }
            if let Some(e) = v["error"].as_str() {
                return Err(e.to_string());
            }
            return Ok(v["faces"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|f| {
                    let b: Vec<f32> = f["box"].as_array()?.iter().filter_map(|x| x.as_f64()).map(|x| x as f32).collect();
                    let mut e: Vec<f32> = f["emb"].as_array()?.iter().filter_map(|x| x.as_f64()).map(|x| x as f32).collect();
                    if b.len() != 4 || e.len() != DIM {
                        return None;
                    }
                    let n = e.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
                    e.iter_mut().for_each(|x| *x /= n);
                    Some(FaceRec { bbox: [b[0], b[1], b[2], b[3]], emb: e })
                })
                .collect());
        }
    }
}

impl Drop for FaceProc {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Größte Ähnlichkeit (cos) zwischen Gesichtern eines Fotos und einer gemerkten Gruppe
pub fn best_match(faces: &[FaceRec], group: &[Vec<f32>]) -> f32 {
    let mut best = -1f32;
    for f in faces {
        for g in group {
            let n = g.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
            let c = f.emb.iter().zip(g).map(|(a, b)| a * b).sum::<f32>() / n;
            best = best.max(c);
        }
    }
    best
}
