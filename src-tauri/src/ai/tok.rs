//! Zerlegt Text in Wortstücke (WordPiece, wie bei BERT): "Wiesen" → "Wiese", "##n".
//! Groß-/Kleinschreibung und Akzente bleiben erhalten (das Modell ist "cased").

use std::collections::HashMap;

pub struct Tokenizer {
    ids: HashMap<String, usize>,
    unk: usize,
    cls: usize,
    sep: usize,
}

fn is_punct(c: char) -> bool {
    let o = c as u32;
    (33..=47).contains(&o)
        || (58..=64).contains(&o)
        || (91..=96).contains(&o)
        || (123..=126).contains(&o)
        || matches!(c, '¡' | '§' | '«' | '¶' | '·' | '»' | '¿' | '‐'..='‧' | '‰'..='⁞' | '、' | '。' | '「' | '」')
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x20000..=0x2A6DF | 0x2A700..=0x2B73F | 0x2B740..=0x2B81F | 0x2B820..=0x2CEAF | 0xF900..=0xFAFF | 0x2F800..=0x2FA1F)
}

impl Tokenizer {
    pub fn new(vocab: &[String], unk: usize, cls: usize, sep: usize) -> Tokenizer {
        let ids = vocab.iter().enumerate().map(|(i, w)| (w.clone(), i)).collect();
        Tokenizer { ids, unk, cls, sep }
    }

    fn words(text: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut cur = String::new();
        let flush = |cur: &mut String, out: &mut Vec<String>| {
            if !cur.is_empty() {
                out.push(std::mem::take(cur));
            }
        };
        for c in text.chars() {
            if c == '\0' || c == '\u{fffd}' || (c.is_control() && !c.is_whitespace()) {
                continue;
            }
            if c.is_whitespace() {
                flush(&mut cur, &mut out);
            } else if is_punct(c) || is_cjk(c) {
                flush(&mut cur, &mut out);
                out.push(c.to_string());
            } else {
                cur.push(c);
            }
        }
        flush(&mut cur, &mut out);
        out
    }

    pub fn encode(&self, text: &str, max: usize) -> Vec<usize> {
        let mut ids = vec![self.cls];
        'w: for w in Self::words(text) {
            let chars: Vec<char> = w.chars().collect();
            if chars.len() > 100 {
                ids.push(self.unk);
                continue;
            }
            let mut pieces = Vec::new();
            let mut start = 0;
            while start < chars.len() {
                let mut end = chars.len();
                let mut found = None;
                while start < end {
                    let mut s: String = chars[start..end].iter().collect();
                    if start > 0 {
                        s = format!("##{s}");
                    }
                    if let Some(&id) = self.ids.get(&s) {
                        found = Some(id);
                        break;
                    }
                    end -= 1;
                }
                match found {
                    Some(id) => pieces.push(id),
                    None => {
                        ids.push(self.unk);
                        continue 'w;
                    }
                }
                start = end;
            }
            ids.extend(pieces);
        }
        ids.truncate(max - 1);
        ids.push(self.sep);
        ids
    }
}

/// BPE-Zerlegung wie bei SentencePiece/Gemma (für SigLIP 2): Text → Zeichen → häufigste
/// Paare werden schrittweise zusammengefügt. Unbekannte Zeichen als einzelne Bytes.
pub struct Bpe {
    ids: HashMap<String, usize>,
    ranks: HashMap<(String, String), usize>,
    byte_fallback: bool,
    unk: usize,
    pad: usize,
    /// Schritte des Normalisierers (z. B. Leerzeichen → "▁")
    norm: Vec<Norm>,
    /// Sondertexte vor/nach dem Text (z. B. <bos> … <eos>)
    pre: Vec<usize>,
    post: Vec<usize>,
}

enum Norm {
    Replace(String, String),
    Prepend(String),
    Lowercase,
}

fn parse_norm(v: &serde_json::Value, out: &mut Vec<Norm>) {
    match v["type"].as_str() {
        Some("Sequence") => {
            for x in v["normalizers"].as_array().into_iter().flatten() {
                parse_norm(x, out);
            }
        }
        Some("Replace") => {
            if let (Some(p), Some(c)) = (v["pattern"]["String"].as_str(), v["content"].as_str()) {
                out.push(Norm::Replace(p.to_string(), c.to_string()));
            }
        }
        Some("Prepend") => {
            if let Some(p) = v["prepend"].as_str() {
                out.push(Norm::Prepend(p.to_string()));
            }
        }
        Some("Lowercase") => out.push(Norm::Lowercase),
        _ => {}
    }
}

impl Bpe {
    pub fn new(vocab: &[String], merges: &[String], meta: &HashMap<String, String>) -> Bpe {
        let ids: HashMap<String, usize> = vocab.iter().enumerate().map(|(i, w)| (w.clone(), i)).collect();
        let ranks = merges
            .iter()
            .enumerate()
            .filter_map(|(i, m)| m.split_once('\u{1}').or_else(|| m.split_once(' ')).map(|(a, b)| ((a.to_string(), b.to_string()), i)))
            .collect();
        let num = |k: &str| meta.get(k).and_then(|v| v.parse().ok());
        let mut norm = Vec::new();
        if let Some(v) = meta.get("normalizer").and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()) {
            parse_norm(&v, &mut norm);
        }
        // Nachbearbeitung: Vorlage wie [<bos>, $A, <eos>]
        let (mut pre, mut post) = (Vec::new(), Vec::new());
        if let Some(v) = meta.get("post").and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()) {
            let mut seen_a = false;
            for item in v["single"].as_array().into_iter().flatten() {
                if item.get("Sequence").is_some() {
                    seen_a = true;
                } else if let Some(sp) = item["SpecialToken"]["id"].as_str() {
                    if let Some(&id) = ids.get(sp) {
                        if seen_a { post.push(id) } else { pre.push(id) }
                    }
                }
            }
        }
        Bpe {
            byte_fallback: meta.get("byte_fallback").map(String::as_str) == Some("1"),
            unk: num("unk").unwrap_or(0),
            pad: num("pad").unwrap_or(0),
            ids,
            ranks,
            norm,
            pre,
            post,
        }
    }

    fn normalize(&self, text: &str) -> String {
        let mut s = text.to_string();
        for n in &self.norm {
            match n {
                Norm::Replace(a, b) => s = s.replace(a.as_str(), b),
                Norm::Prepend(p) => s = format!("{p}{s}"),
                Norm::Lowercase => s = s.to_lowercase(),
            }
        }
        s
    }

    /// Wort-Nummern, aufgefüllt auf `max` (wie beim Training von SigLIP)
    pub fn encode(&self, text: &str, max: usize) -> Vec<usize> {
        let s = self.normalize(text);
        // Startstücke: einzelne Zeichen (oder Bytes, wenn das Zeichen unbekannt ist)
        let mut parts: Vec<String> = Vec::new();
        for c in s.chars() {
            let cs = c.to_string();
            if self.ids.contains_key(&cs) || !self.byte_fallback {
                parts.push(cs);
            } else {
                let mut buf = [0u8; 4];
                for b in c.encode_utf8(&mut buf).bytes() {
                    parts.push(format!("<0x{b:02X}>"));
                }
            }
        }
        loop {
            let mut best: Option<(usize, usize)> = None;
            for i in 0..parts.len().saturating_sub(1) {
                if let Some(&r) = self.ranks.get(&(parts[i].clone(), parts[i + 1].clone())) {
                    if best.map_or(true, |(br, _)| r < br) {
                        best = Some((r, i));
                    }
                }
            }
            let Some((_, i)) = best else { break };
            let merged = format!("{}{}", parts[i], parts[i + 1]);
            parts[i] = merged;
            parts.remove(i + 1);
        }
        let mut ids = self.pre.clone();
        ids.extend(parts.iter().map(|p| *self.ids.get(p).unwrap_or(&self.unk)));
        ids.truncate(max.saturating_sub(self.post.len()));
        ids.extend(&self.post);
        ids.resize(max, self.pad);
        ids
    }
}
