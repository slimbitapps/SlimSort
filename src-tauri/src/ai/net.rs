//! Das neuronale Netz selbst – ohne fremde KI-Bibliothek, nur Rechnen mit Zahlen.
//!
//! Bild: CLIP ViT-B/32 (zerlegt das Bild in 7×7 Kacheln à 32 px, 12 Schichten).
//! Text: mehrsprachiges DistilBERT (6 Schichten), danach auf dieselben 512 Zahlen abgebildet.
//! Beide liefern einen "Fingerabdruck" aus 512 Zahlen; ähnlicher Inhalt = ähnliche Zahlen.
//!
//! Gewichte liegen als 8-Bit-Zahlen im Speicher (klein) und werden schichtweise
//! in einen Zwischenpuffer ausgepackt.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// 8-Bit-Gewicht [rows × cols] mit einem Faktor je Zeile
struct QMat {
    q: Vec<i8>,
    s: Vec<f32>,
    rows: usize,
    cols: usize,
}

pub struct Weights {
    q: HashMap<String, QMat>,
    f: HashMap<String, Vec<f32>>,
    pub meta: HashMap<String, String>,
    pub vocab: Vec<String>,
}

fn bad(m: &str) -> String {
    format!("Modelldatei beschädigt: {m}")
}

impl Weights {
    /// Liest eine .safetensors-Datei (Kopf als JSON, danach die Rohdaten).
    pub fn load(path: &Path) -> Result<Weights, String> {
        let mut f = File::open(path).map_err(|e| e.to_string())?;
        let mut len = [0u8; 8];
        f.read_exact(&mut len).map_err(|e| e.to_string())?;
        let hl = u64::from_le_bytes(len) as usize;
        if hl > 64 << 20 {
            return Err(bad("Kopf"));
        }
        let mut head = vec![0u8; hl];
        f.read_exact(&mut head).map_err(|e| e.to_string())?;
        let head: serde_json::Value = serde_json::from_slice(&head).map_err(|_| bad("Kopf"))?;
        let mut data = Vec::new();
        f.read_to_end(&mut data).map_err(|e| e.to_string())?;

        let mut meta = HashMap::new();
        let mut raw_i8: HashMap<String, (Vec<i8>, Vec<usize>)> = HashMap::new();
        let mut raw_f32: HashMap<String, Vec<f32>> = HashMap::new();
        let mut vocab_bytes = Vec::new();
        for (name, v) in head.as_object().ok_or_else(|| bad("Kopf"))? {
            if name == "__metadata__" {
                for (k, x) in v.as_object().into_iter().flatten() {
                    meta.insert(k.clone(), x.as_str().unwrap_or_default().to_string());
                }
                continue;
            }
            let dt = v["dtype"].as_str().unwrap_or_default();
            let shape: Vec<usize> = v["shape"].as_array().ok_or_else(|| bad(name))?.iter().map(|d| d.as_u64().unwrap_or(0) as usize).collect();
            let off = v["data_offsets"].as_array().ok_or_else(|| bad(name))?;
            let (a, b) = (off[0].as_u64().unwrap_or(0) as usize, off[1].as_u64().unwrap_or(0) as usize);
            let bytes = data.get(a..b).ok_or_else(|| bad(name))?;
            match dt {
                "I8" => {
                    raw_i8.insert(name.clone(), (bytes.iter().map(|&x| x as i8).collect(), shape));
                }
                "U8" if name == "vocab" => vocab_bytes = bytes.to_vec(),
                "F32" => {
                    raw_f32.insert(name.clone(), bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect());
                }
                _ => return Err(bad(name)),
            }
        }
        drop(data);
        let mut q = HashMap::new();
        for (name, (vals, shape)) in raw_i8 {
            let base = name.strip_suffix(".q").unwrap_or(&name).to_string();
            let s = raw_f32.remove(&format!("{base}.s")).ok_or_else(|| bad(&base))?;
            let (rows, cols) = (shape[0], shape.iter().skip(1).product());
            if s.len() != rows || vals.len() != rows * cols {
                return Err(bad(&base));
            }
            q.insert(base, QMat { q: vals, s, rows, cols });
        }
        let vocab = String::from_utf8(vocab_bytes).map_err(|_| bad("Wortliste"))?.split('\n').map(str::to_string).collect();
        if meta.get("format").map(String::as_str) != Some("slimsort-ki-1") {
            return Err(bad("unbekanntes Format"));
        }
        Ok(Weights { q, f: raw_f32, meta, vocab })
    }

    pub fn m(&self, k: &str) -> usize {
        self.meta.get(k).and_then(|v| v.parse().ok()).unwrap_or(0)
    }

    fn mf(&self, k: &str) -> f32 {
        self.meta.get(k).and_then(|v| v.parse().ok()).unwrap_or(1e-5)
    }

    fn f(&self, k: &str) -> &[f32] {
        self.f.get(k).map(Vec::as_slice).unwrap_or_else(|| panic!("fehlt: {k}"))
    }

    fn qm(&self, k: &str) -> &QMat {
        self.q.get(k).unwrap_or_else(|| panic!("fehlt: {k}"))
    }

    /// Zeile einer 8-Bit-Matrix als Fließkommazahlen (für die Wort-Tabelle)
    fn row(&self, k: &str, r: usize) -> Vec<f32> {
        let m = self.qm(k);
        let s = m.s[r];
        m.q[r * m.cols..(r + 1) * m.cols].iter().map(|&v| v as f32 * s).collect()
    }
}

/// Rechenpuffer – jeder Arbeits-Thread hat seinen eigenen.
#[derive(Default)]
pub struct Scratch {
    w: Vec<f32>,
}

/// y[n × out] = x[n × in] · Wᵀ (+ b)
fn linear(wt: &Weights, sc: &mut Scratch, name: &str, x: &[f32], n: usize) -> Vec<f32> {
    let m = wt.qm(name);
    let (out, inp) = (m.rows, m.cols);
    debug_assert_eq!(x.len(), n * inp);
    sc.w.resize(out * inp, 0.0);
    for r in 0..out {
        let s = m.s[r];
        let src = &m.q[r * inp..(r + 1) * inp];
        let dst = &mut sc.w[r * inp..(r + 1) * inp];
        for (d, &q) in dst.iter_mut().zip(src) {
            *d = q as f32 * s;
        }
    }
    let mut y = vec![0f32; n * out];
    unsafe {
        matrixmultiply::sgemm(
            n, inp, out, 1.0,
            x.as_ptr(), inp as isize, 1,
            sc.w.as_ptr(), 1, inp as isize,
            0.0, y.as_mut_ptr(), out as isize, 1,
        );
    }
    if let Some(b) = wt.f.get(&format!("{name}.b")) {
        for row in y.chunks_exact_mut(out) {
            for (v, bb) in row.iter_mut().zip(b) {
                *v += bb;
            }
        }
    }
    y
}

fn layer_norm(wt: &Weights, name: &str, x: &mut [f32], d: usize, eps: f32) {
    let (g, b) = (wt.f(&format!("{name}.w")), wt.f(&format!("{name}.b")));
    for row in x.chunks_exact_mut(d) {
        let mean = row.iter().sum::<f32>() / d as f32;
        let var = row.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / d as f32;
        let inv = 1.0 / (var + eps).sqrt();
        for i in 0..d {
            row[i] = (row[i] - mean) * inv * g[i] + b[i];
        }
    }
}

/// Fehlerfunktion (Abramowitz & Stegun 7.1.26, Fehler < 2e-7)
fn erf(x: f32) -> f32 {
    let s = x.signum();
    let x = x.abs() as f64;
    let t = 1.0 / (1.0 + 0.3275911 * x);
    let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * (-x * x).exp();
    s * y as f32
}

/// Mehrkopf-Aufmerksamkeit: jeder Teil schaut, welche anderen Teile wichtig sind.
fn attention(q: &[f32], k: &[f32], v: &[f32], n: usize, d: usize, heads: usize) -> Vec<f32> {
    let dh = d / heads;
    let scale = 1.0 / (dh as f32).sqrt();
    let mut out = vec![0f32; n * d];
    let mut p = vec![0f32; n];
    for h in 0..heads {
        let o = h * dh;
        for i in 0..n {
            let qi = &q[i * d + o..i * d + o + dh];
            let mut mx = f32::MIN;
            for j in 0..n {
                let kj = &k[j * d + o..j * d + o + dh];
                let s = qi.iter().zip(kj).map(|(a, b)| a * b).sum::<f32>() * scale;
                p[j] = s;
                mx = mx.max(s);
            }
            let mut sum = 0.0;
            for pj in p.iter_mut() {
                *pj = (*pj - mx).exp();
                sum += *pj;
            }
            let dst = &mut out[i * d + o..i * d + o + dh];
            for j in 0..n {
                let w = p[j] / sum;
                let vj = &v[j * d + o..j * d + o + dh];
                for (a, b) in dst.iter_mut().zip(vj) {
                    *a += w * b;
                }
            }
        }
    }
    out
}

fn add(a: &mut [f32], b: &[f32]) {
    for (x, y) in a.iter_mut().zip(b) {
        *x += y;
    }
}

pub fn normalize(v: &mut [f32]) {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
    for x in v.iter_mut() {
        *x /= n;
    }
}

pub const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
pub const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];

/// Bild-Fingerabdruck. `rgb` = 224×224×3 Bytes.
pub fn embed_image(wt: &Weights, sc: &mut Scratch, rgb: &[u8]) -> Vec<f32> {
    let (d, p, size, heads) = (wt.m("v_dim"), wt.m("v_patch"), wt.m("v_size"), wt.m("v_heads"));
    let eps = wt.mf("v_eps");
    let g = size / p;
    let np = g * g;
    // Kacheln ausschneiden: [np × (3·p·p)] in der Reihenfolge Farbe, Zeile, Spalte
    let mut patches = vec![0f32; np * 3 * p * p];
    for gy in 0..g {
        for gx in 0..g {
            let base = (gy * g + gx) * 3 * p * p;
            for c in 0..3 {
                for yy in 0..p {
                    for xx in 0..p {
                        let px = rgb[((gy * p + yy) * size + gx * p + xx) * 3 + c] as f32 / 255.0;
                        patches[base + c * p * p + yy * p + xx] = (px - MEAN[c]) / STD[c];
                    }
                }
            }
        }
    }
    let pe = linear(wt, sc, "v.patch", &patches, np);
    let n = np + 1;
    let mut x = vec![0f32; n * d];
    x[..d].copy_from_slice(wt.f("v.cls"));
    x[d..].copy_from_slice(&pe);
    add(&mut x, &wt.f("v.pos")[..n * d]);
    layer_norm(wt, "v.pre", &mut x, d, eps);
    for l in 0..wt.m("v_layers") {
        let pf = format!("v.{l}.");
        let mut h = x.clone();
        layer_norm(wt, &format!("{pf}ln1"), &mut h, d, eps);
        let q = linear(wt, sc, &format!("{pf}q"), &h, n);
        let k = linear(wt, sc, &format!("{pf}k"), &h, n);
        let v = linear(wt, sc, &format!("{pf}v"), &h, n);
        let a = attention(&q, &k, &v, n, d, heads);
        let o = linear(wt, sc, &format!("{pf}o"), &a, n);
        add(&mut x, &o);
        let mut h = x.clone();
        layer_norm(wt, &format!("{pf}ln2"), &mut h, d, eps);
        let mut f = linear(wt, sc, &format!("{pf}fc1"), &h, n);
        for v in f.iter_mut() {
            *v *= 1.0 / (1.0 + (-1.702 * *v).exp()); // quick_gelu
        }
        let f2 = linear(wt, sc, &format!("{pf}fc2"), &f, n);
        add(&mut x, &f2);
    }
    let mut cls = x[..d].to_vec();
    layer_norm(wt, "v.post", &mut cls, d, eps);
    let mut e = linear(wt, sc, "v.proj", &cls, 1);
    normalize(&mut e);
    e
}

/// Text-Fingerabdruck aus Wort-Nummern (mit [CLS] … [SEP]).
pub fn embed_text(wt: &Weights, sc: &mut Scratch, ids: &[usize]) -> Vec<f32> {
    let (d, heads) = (wt.m("t_dim"), wt.m("t_heads"));
    let eps = wt.mf("t_eps");
    let n = ids.len().min(wt.m("t_max"));
    let pos = wt.f("t.pos");
    let mut x = vec![0f32; n * d];
    for (i, &id) in ids.iter().take(n).enumerate() {
        let w = wt.row("t.word", id);
        for j in 0..d {
            x[i * d + j] = w[j] + pos[i * d + j];
        }
    }
    layer_norm(wt, "t.ln", &mut x, d, eps);
    for l in 0..wt.m("t_layers") {
        let pf = format!("t.{l}.");
        let q = linear(wt, sc, &format!("{pf}q"), &x, n);
        let k = linear(wt, sc, &format!("{pf}k"), &x, n);
        let v = linear(wt, sc, &format!("{pf}v"), &x, n);
        let a = attention(&q, &k, &v, n, d, heads);
        let o = linear(wt, sc, &format!("{pf}o"), &a, n);
        add(&mut x, &o);
        layer_norm(wt, &format!("{pf}ln1"), &mut x, d, eps);
        let mut f = linear(wt, sc, &format!("{pf}fc1"), &x, n);
        for v in f.iter_mut() {
            *v = 0.5 * *v * (1.0 + erf(*v / std::f32::consts::SQRT_2)); // gelu
        }
        let f2 = linear(wt, sc, &format!("{pf}fc2"), &f, n);
        add(&mut x, &f2);
        layer_norm(wt, &format!("{pf}ln2"), &mut x, d, eps);
    }
    // Mittelwert über alle Wörter
    let mut mean = vec![0f32; d];
    for row in x.chunks_exact(d) {
        add(&mut mean, row);
    }
    for v in mean.iter_mut() {
        *v /= n as f32;
    }
    let mut e = linear(wt, sc, "t.proj", &mean, 1);
    normalize(&mut e);
    e
}
