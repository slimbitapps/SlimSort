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
