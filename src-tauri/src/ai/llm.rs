//! Steuert das Helfer-Programm für den KI-Chat (eigener Prozess mit llama.cpp).
//!
//! Warum ein eigener Prozess? Die App bleibt klein und läuft auf jedem Prozessor; das
//! Sprachmodell wird nur geladen, wenn man eine Stufe mit Chat wählt, und belegt den
//! Arbeitsspeicher nur, solange es gebraucht wird (nach 10 Minuten Pause wird es beendet).

use crate::session::Emit;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const IDLE_STOP: Duration = Duration::from_secs(600);

struct Proc {
    child: Child,
    stdin: ChildStdin,
    model: PathBuf,
}

type Waiters = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

pub struct Llm {
    proc: Mutex<Option<Proc>>,
    waiters: Waiters,
    /// None = lädt noch, Some(Ok) = bereit, Some(Err) = Fehler beim Laden
    ready: Arc<(Mutex<Option<Result<(), String>>>, Condvar)>,
    last_use: Arc<Mutex<Instant>>,
    pub emit: Mutex<Option<Emit>>,
    starting: Mutex<()>,
}

impl Llm {
    pub fn new() -> Arc<Llm> {
        let me = Arc::new(Llm {
            proc: Mutex::new(None),
            waiters: Arc::new(Mutex::new(HashMap::new())),
            ready: Arc::new((Mutex::new(None), Condvar::new())),
            last_use: Arc::new(Mutex::new(Instant::now())),
            emit: Mutex::new(None),
            starting: Mutex::new(()),
        });
        // nach langer Pause beenden (gibt den Arbeitsspeicher frei)
        let w = Arc::downgrade(&me);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(30));
            let Some(me) = w.upgrade() else { return };
            if me.running() && me.last_use.lock().unwrap().elapsed() > IDLE_STOP && me.waiters.lock().unwrap().is_empty() {
                me.stop();
            }
        });
        me
    }

    pub fn running(&self) -> bool {
        let mut p = self.proc.lock().unwrap();
        match p.as_mut() {
            Some(pr) => pr.child.try_wait().ok().flatten().is_none(),
            None => false,
        }
    }

    pub fn stop(&self) {
        if let Some(mut pr) = self.proc.lock().unwrap().take() {
            let _ = writeln!(pr.stdin, "{}", json!({ "quit": true }));
            let _ = pr.child.kill();
            let _ = pr.child.wait();
        }
        *self.ready.0.lock().unwrap() = None;
        // wartende Anfragen beenden
        for (_, tx) in self.waiters.lock().unwrap().drain() {
            let _ = tx.send(json!({ "error": "beendet" }));
        }
    }

    /// Startet das Helfer-Programm (wenn nicht schon mit diesem Modell gestartet) und wartet, bis es bereit ist.
    pub fn start(&self, helper: &Path, model: &Path, threads: usize, gpu: bool) -> Result<(), String> {
        let _s = self.starting.lock().unwrap();
        *self.last_use.lock().unwrap() = Instant::now();
        let same = self.proc.lock().unwrap().as_ref().is_some_and(|p| p.model == model);
        if !(same && self.running()) {
            self.stop();
            let mut cmd = Command::new(helper);
            cmd.arg("--model").arg(model).arg("--threads").arg(threads.to_string()).arg("--ctx").arg("4096");
            if gpu {
                cmd.arg("--gpu");
            }
            cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000); // kein Konsolenfenster
            }
            let mut child = cmd.spawn().map_err(|e| format!("Helfer-Programm startet nicht ({e})"))?;
            let stdin = child.stdin.take().ok_or("keine Eingabe")?;
            let stdout = child.stdout.take().ok_or("keine Ausgabe")?;
            *self.ready.0.lock().unwrap() = None;
            let (waiters, ready) = (self.waiters.clone(), self.ready.clone());
            let emit = self.emit.lock().unwrap().clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                    if v.get("ready").is_some() {
                        *ready.0.lock().unwrap() = Some(Ok(()));
                        ready.1.notify_all();
                    } else if let Some(f) = v.get("fatal").and_then(Value::as_str) {
                        *ready.0.lock().unwrap() = Some(Err(f.to_string()));
                        ready.1.notify_all();
                    } else if let Some(id) = v.get("id").and_then(Value::as_u64) {
                        if v.get("t").is_some() {
                            if let Some(e) = &emit {
                                e("llm:token", v);
                            }
                        } else if let Some(tx) = waiters.lock().unwrap().remove(&id) {
                            let _ = tx.send(v);
                        }
                    }
                }
                // Prozess beendet
                let mut r = ready.0.lock().unwrap();
                if r.is_none() {
                    *r = Some(Err("Helfer-Programm beendet".into()));
                }
                ready.1.notify_all();
                for (_, tx) in waiters.lock().unwrap().drain() {
                    let _ = tx.send(json!({ "error": "Helfer-Programm beendet" }));
                }
            });
            *self.proc.lock().unwrap() = Some(Proc { child, stdin, model: model.to_path_buf() });
        }
        // warten, bis das Modell geladen ist (große Modelle: einige Sekunden)
        let (m, cv) = &*self.ready;
        let g = cv.wait_timeout_while(m.lock().unwrap(), Duration::from_secs(180), |r| r.is_none()).unwrap().0;
        match g.clone() {
            Some(Ok(())) => Ok(()),
            Some(Err(e)) => {
                drop(g);
                self.stop();
                Err(e)
            }
            None => Err("Sprachmodell lädt zu lange".into()),
        }
    }

    /// Text erzeugen; die Wörter kommen nebenbei als Ereignis "llm:token" ({id, t}).
    pub fn generate(&self, id: u64, req: Value) -> Result<Value, String> {
        *self.last_use.lock().unwrap() = Instant::now();
        let (tx, rx) = mpsc::channel();
        self.waiters.lock().unwrap().insert(id, tx);
        let mut msg = req;
        msg["id"] = json!(id);
        {
            let mut p = self.proc.lock().unwrap();
            let pr = p.as_mut().ok_or("Sprachmodell läuft nicht")?;
            writeln!(pr.stdin, "{msg}").and_then(|_| pr.stdin.flush()).map_err(|e| e.to_string())?;
        }
        let r = rx.recv_timeout(Duration::from_secs(300)).map_err(|_| {
            self.waiters.lock().unwrap().remove(&id);
            "Zeitüberschreitung".to_string()
        })?;
        *self.last_use.lock().unwrap() = Instant::now();
        if let Some(e) = r.get("error").and_then(Value::as_str) {
            return Err(e.to_string());
        }
        Ok(r)
    }

    pub fn cancel(&self, id: u64) {
        if let Some(pr) = self.proc.lock().unwrap().as_mut() {
            let _ = writeln!(pr.stdin, "{}", json!({ "cancel": id }));
            let _ = pr.stdin.flush();
        }
    }
}

impl Drop for Llm {
    fn drop(&mut self) {
        self.stop();
    }
}
