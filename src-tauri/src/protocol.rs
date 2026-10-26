//! Liefert Dateien, Vorschaubilder und große Vorschauen an die Oberfläche:
//!   media://localhost/?p=<Pfad>            Originaldatei (mit Range für Videos)
//!   thumb://localhost/?p=<Pfad>&s=256      Vorschaubild (zwischengespeichert)
//!   preview://localhost/?p=<Pfad>&s=3072   bildschirmgroße Ansicht
//! (Windows: http://media.localhost/… usw.)

use crate::scanner::{ext_of, is_browser_image};
use crate::thumbs::{self, Cache, Pool};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::http::{header, Request, Response, StatusCode};

const MAX_CHUNK: u64 = 8 * 1024 * 1024;

fn mime(ext: &str) -> &'static str {
    match ext {
        ".jpg" | ".jpeg" | ".jpe" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".avif" => "image/avif",
        ".bmp" => "image/bmp",
        ".heic" | ".heif" => "image/heic",
        ".mp4" | ".m4v" => "video/mp4",
        ".mov" => "video/quicktime",
        ".webm" => "video/webm",
        ".mkv" => "video/x-matroska",
        ".avi" => "video/x-msvideo",
        ".3gp" => "video/3gpp",
        _ => "application/octet-stream",
    }
}

pub fn query(req: &Request<Vec<u8>>) -> (Option<PathBuf>, u32) {
    let q = req.uri().query().unwrap_or("");
    let mut file = None;
    let mut size = 256;
    for pair in q.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let v = percent_encoding::percent_decode_str(&v.replace('+', "%20")).decode_utf8_lossy().into_owned();
        match k {
            "p" => file = Some(PathBuf::from(v)),
            "s" => size = v.parse().unwrap_or(256),
            _ => {}
        }
    }
    (file, size.clamp(16, 8192))
}

fn base(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder().status(status).header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
}

pub fn not_found() -> Response<Vec<u8>> {
    base(StatusCode::NOT_FOUND).body(Vec::new()).unwrap()
}

fn bytes(data: Vec<u8>, kind: &str) -> Response<Vec<u8>> {
    base(StatusCode::OK).header(header::CONTENT_TYPE, kind).header(header::CACHE_CONTROL, "no-cache").body(data).unwrap()
}

/// Datei ausliefern – mit Teilbereichen (Range), damit Videos springen können.
pub fn serve_file(path: &Path, req: &Request<Vec<u8>>) -> std::io::Result<Response<Vec<u8>>> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    let kind = mime(&ext_of(&path.to_string_lossy()));
    let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(parse_range);
    let video = kind.starts_with("video/");
    match range {
        Some((start, end)) if len > 0 => {
            let (start, mut end) = match (start, end) {
                (Some(s), Some(e)) => (s, e),
                (Some(s), None) => (s, len - 1),
                (None, Some(n)) => (len.saturating_sub(n), len - 1),
                (None, None) => (0, len - 1),
            };
            end = end.min(len - 1).min(start.saturating_add(MAX_CHUNK - 1));
            if start > end || start >= len {
                return Ok(base(StatusCode::RANGE_NOT_SATISFIABLE).header(header::CONTENT_RANGE, format!("bytes */{len}")).body(Vec::new()).unwrap());
            }
            f.seek(SeekFrom::Start(start))?;
            let mut buf = vec![0u8; (end - start + 1) as usize];
            f.read_exact(&mut buf)?;
            Ok(base(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, kind)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, buf.len().to_string())
                .body(buf)
                .unwrap())
        }
        _ if video && len > MAX_CHUNK => {
            // Ohne Range nur den Anfang schicken – der Player fragt den Rest stückweise an
            let mut buf = vec![0u8; MAX_CHUNK as usize];
            f.read_exact(&mut buf)?;
            Ok(base(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, kind)
                .header(header::CONTENT_RANGE, format!("bytes 0-{}/{len}", MAX_CHUNK - 1))
                .header(header::ACCEPT_RANGES, "bytes")
                .body(buf)
                .unwrap())
        }
        _ => {
            let mut buf = Vec::with_capacity(len as usize);
            f.read_to_end(&mut buf)?;
            Ok(base(StatusCode::OK).header(header::CONTENT_TYPE, kind).header(header::ACCEPT_RANGES, "bytes").body(buf).unwrap())
        }
    }
}

fn parse_range(v: &str) -> Option<(Option<u64>, Option<u64>)> {
    let r = v.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = r.split_once('-')?;
    let a = a.trim().parse().ok();
    let b = b.trim().parse().ok();
    if a.is_none() && b.is_none() {
        return None;
    }
    Some((a, b))
}

pub struct Media {
    pub cache: Arc<Cache>,
    pub pool: Arc<Pool>,
    pub broken: bool,
    pub log: Arc<dyn Fn(String) + Send + Sync>,
}

impl Media {
    pub fn media(&self, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
        let (Some(file), _) = query(&req) else { return not_found() };
        serve_file(&file, &req).unwrap_or_else(|e| {
            (self.log)(format!("media {} {e}", file.display()));
            not_found()
        })
    }

    /// Kein Vorschaubild möglich: Original liefern, wenn die Webansicht es selbst anzeigen kann.
    fn fallback(file: &Path, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        if is_browser_image(&ext_of(&file.to_string_lossy())) {
            serve_file(file, req).unwrap_or_else(|_| not_found())
        } else {
            not_found()
        }
    }

    pub fn thumb(self: &Arc<Self>, req: Request<Vec<u8>>, respond: Box<dyn FnOnce(Response<Vec<u8>>) + Send>) {
        if self.broken {
            return respond(not_found());
        }
        let (Some(file), size) = query(&req) else { return respond(not_found()) };
        let Some(key) = Cache::key(&file, &size.to_string()) else { return respond(not_found()) };
        let out = self.cache.thumb_path(&key);
        if let Ok(data) = std::fs::read(&out) {
            return respond(bytes(data, "image/jpeg"));
        }
        let me = self.clone();
        self.pool.push(Box::new(move || {
            let ext = ext_of(&file.to_string_lossy());
            match thumbs::render(&file, &ext, size, 80) {
                Some(data) => {
                    me.cache.store_thumb(&key, &data);
                    respond(bytes(data, "image/jpeg"))
                }
                None => respond(Self::fallback(&file, &req)),
            }
        }));
    }

    pub fn preview(self: &Arc<Self>, req: Request<Vec<u8>>, respond: Box<dyn FnOnce(Response<Vec<u8>>) + Send>) {
        if self.broken {
            return respond(not_found());
        }
        let (Some(file), size) = query(&req) else { return respond(not_found()) };
        let Some(key) = Cache::key(&file, &format!("p{size}")) else { return respond(not_found()) };
        if let Some(data) = self.cache.mem_get(&key) {
            return respond(bytes((*data).clone(), "image/jpeg"));
        }
        let me = self.clone();
        self.pool.push(Box::new(move || {
            let ext = ext_of(&file.to_string_lossy());
            match thumbs::render(&file, &ext, size, 86) {
                Some(data) => {
                    me.cache.mem_put(key, Arc::new(data.clone()));
                    respond(bytes(data, "image/jpeg"))
                }
                None => respond(Self::fallback(&file, &req)),
            }
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-"), Some((Some(0), None)));
        assert_eq!(parse_range("bytes=100-199"), Some((Some(100), Some(199))));
        assert_eq!(parse_range("bytes=-500"), Some((None, Some(500))));
        assert_eq!(parse_range("items=1-2"), None);
    }
}
