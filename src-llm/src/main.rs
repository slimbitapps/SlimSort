//! Hilfsprogramm für den KI-Chat von SlimSort.
//!
//! Wird von SlimSort gestartet (nur wenn eine KI-Stufe mit Sprachmodell gewählt ist) und
//! über Standard-Ein-/Ausgabe gesteuert – eine JSON-Zeile pro Nachricht:
//!
//!   → {"id":1,"prompt":"<|im_start|>…","max":300,"temp":0.7,"grammar":null,"stop":["<|im_end|>"]}
//!   ← {"id":1,"t":"Hal"}  {"id":1,"t":"lo"}  …  {"id":1,"done":true,"text":"Hallo","tokens":2,"ms":120}
//!   → {"cancel":1}       bricht die laufende Antwort ab
//!
//! Gleicher Anfang wie bei der vorigen Anfrage (z. B. die Anleitung für die KI) wird nicht
//! neu berechnet – das macht Folgefragen schnell.

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use serde::Deserialize;
use serde_json::json;
use std::io::{BufRead, Write};
use std::num::NonZeroU32;
use std::sync::mpsc;
use std::time::Instant;

#[derive(Deserialize)]
struct Req {
    id: Option<u64>,
    prompt: Option<String>,
    #[serde(default)]
    max: Option<usize>,
    #[serde(default)]
    temp: Option<f32>,
    #[serde(default)]
    grammar: Option<String>,
    #[serde(default)]
    stop: Vec<String>,
    cancel: Option<u64>,
    #[serde(default)]
    quit: bool,
}

fn out(v: serde_json::Value) {
    let mut o = std::io::stdout().lock();
    let _ = writeln!(o, "{v}");
    let _ = o.flush();
}

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

fn main() {
    if std::env::args().any(|a| a == "--version") {
        println!("slimsort-llm {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let Some(model_path) = arg("--model") else {
        eprintln!("Aufruf: slimsort-llm --model datei.gguf [--threads N] [--ctx 4096] [--gpu]");
        std::process::exit(2);
    };
    let threads: i32 = arg("--threads").and_then(|v| v.parse().ok()).unwrap_or(4);
    let n_ctx: u32 = arg("--ctx").and_then(|v| v.parse().ok()).unwrap_or(4096);
    let gpu = std::env::args().any(|a| a == "--gpu");

    let mut backend = match LlamaBackend::init() {
        Ok(b) => b,
        Err(e) => return out(json!({ "fatal": format!("backend: {e}") })),
    };
    if std::env::var("SLIMSORT_LLM_LOG").is_err() {
        backend.void_logs();
    }
    let mp = LlamaModelParams::default().with_n_gpu_layers(if gpu { 999 } else { 0 });
    let model = match LlamaModel::load_from_file(&backend, &model_path, &mp) {
        Ok(m) => m,
        Err(e) => return out(json!({ "fatal": format!("Modell: {e}") })),
    };
    let cp = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx))
        .with_n_batch(512)
        .with_n_threads(threads)
        .with_n_threads_batch(threads);
    let mut ctx = match model.new_context(&backend, cp) {
        Ok(c) => c,
        Err(e) => return out(json!({ "fatal": format!("Kontext: {e}") })),
    };
    let n_ctx = ctx.n_ctx() as usize;
    out(json!({ "ready": true, "ctx": n_ctx }));

    // Eingaben in eigenem Thread lesen, damit "cancel" auch während einer Antwort ankommt
    let (tx, rx) = mpsc::channel::<Req>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Req>(&line) {
                Ok(r) => {
                    if tx.send(r).is_err() {
                        break;
                    }
                }
                Err(e) => out(json!({ "error": format!("JSON: {e}") })),
            }
        }
        // Eingabe geschlossen (SlimSort beendet) → selbst beenden
        std::process::exit(0);
    });

    let vocab = model.vocab();
    let mut cached: Vec<LlamaToken> = Vec::new();
    let mut batch = LlamaBatch::new(512, 1);
    let mut pending: Option<Req> = None;

    loop {
        let req = match pending.take() {
            Some(r) => r,
            None => match rx.recv() {
                Ok(r) => r,
                Err(_) => return,
            },
        };
        if req.quit {
            return;
        }
        let (Some(id), Some(prompt)) = (req.id, req.prompt.as_ref()) else { continue };
        let t0 = Instant::now();
        let toks = vocab.tokenize(prompt.as_bytes(), true, true);
        let max = req.max.unwrap_or(300).min(2048);
        if toks.len() + max >= n_ctx {
            out(json!({ "id": id, "error": "zu lang" }));
            continue;
        }
        // gemeinsamen Anfang wiederverwenden
        let mut keep = cached.iter().zip(&toks).take_while(|(a, b)| a == b).count();
        if keep == toks.len() {
            keep -= 1; // mindestens ein Wort neu berechnen (für die Vorhersage)
        }
        if ctx.kv_cache_seq_rm(0, Some(keep as u32), None).is_err() {
            ctx.clear_kv_cache();
            keep = 0;
        }
        cached.truncate(keep);
        let mut ok = true;
        let mut pos = keep;
        while pos < toks.len() {
            batch.clear();
            let end = (pos + 512).min(toks.len());
            for (i, t) in toks[pos..end].iter().enumerate() {
                let p = pos + i;
                if batch.add(*t, p as i32, &[0], p == toks.len() - 1).is_err() {
                    ok = false;
                }
            }
            if !ok || ctx.decode(&mut batch).is_err() {
                ok = false;
                break;
            }
            pos = end;
        }
        if !ok {
            ctx.clear_kv_cache();
            cached.clear();
            out(json!({ "id": id, "error": "Berechnung fehlgeschlagen" }));
            continue;
        }
        cached = toks.clone();

        let temp = req.temp.unwrap_or(0.7);
        let mut chain = Vec::new();
        if let Some(g) = req.grammar.as_deref().filter(|g| !g.is_empty()) {
            match LlamaSampler::grammar(&model, g, "root") {
                Ok(s) => chain.push(s),
                Err(e) => {
                    out(json!({ "id": id, "error": format!("Grammatik: {e:?}") }));
                    continue;
                }
            }
        }
        if temp <= 0.0 {
            chain.push(LlamaSampler::greedy());
        } else {
            chain.push(LlamaSampler::penalties(model.n_vocab(), 64, 1.1, 0.0, 0.0));
            chain.push(LlamaSampler::top_k(40));
            chain.push(LlamaSampler::top_p(0.9, 1));
            chain.push(LlamaSampler::temp(temp));
            chain.push(LlamaSampler::dist(t0.elapsed().as_nanos() as u32 ^ id as u32));
        }
        let mut sampler = LlamaSampler::chain_simple(chain);

        let mut text = String::new();
        let mut raw: Vec<u8> = Vec::new();
        let mut n = 0usize;
        let mut idx = batch.n_tokens() - 1;
        let mut cancelled = false;
        'gen: while n < max {
            // neue Nachrichten prüfen (Abbruch)
            while let Ok(r) = rx.try_recv() {
                if r.cancel == Some(id) || r.quit {
                    cancelled = true;
                    if r.quit {
                        return;
                    }
                } else if r.prompt.is_some() {
                    // neue Anfrage überholt die alte
                    pending = Some(r);
                    cancelled = true;
                }
            }
            if cancelled {
                break;
            }
            let tok = sampler.sample(&ctx, idx);
            if vocab.is_eog(tok) {
                break;
            }
            raw.extend(vocab.token_to_piece(tok, false, None));
            // nur vollständige UTF-8-Zeichen ausgeben
            let valid = match std::str::from_utf8(&raw) {
                Ok(s) => s.len(),
                Err(e) => e.valid_up_to(),
            };
            if valid > 0 {
                let piece = String::from_utf8_lossy(&raw[..valid]).to_string();
                raw.drain(..valid);
                text.push_str(&piece);
                if let Some(s) = req.stop.iter().find(|s| !s.is_empty() && text.contains(s.as_str())) {
                    let cut = text.find(s.as_str()).unwrap_or(text.len());
                    text.truncate(cut);
                    break 'gen;
                }
                out(json!({ "id": id, "t": piece }));
            }
            batch.clear();
            let p = cached.len();
            if let Err(e) = batch.add(tok, p as i32, &[0], true) {
                eprintln!("add: {e:?}");
                break;
            }
            if let Err(e) = ctx.decode(&mut batch) {
                eprintln!("decode bei {p}: {e:?}");
                break;
            }
            cached.push(tok);
            idx = 0;
            n += 1;
        }
        out(json!({ "id": id, "done": true, "text": text, "tokens": n, "ms": t0.elapsed().as_millis() as u64, "cancelled": cancelled }));
    }
}
