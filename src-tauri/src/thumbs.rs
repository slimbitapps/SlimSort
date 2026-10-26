//! Vorschaubilder (klein, auf der Platte zwischengespeichert) und große Vorschauen
//! (bildschirmgroß, nur im Arbeitsspeicher) erzeugen.
//!
//! Reihenfolge: Vorschau des Betriebssystems (macOS: ImageIO, kann HEIC/RAW;
//! Windows: Explorer-Vorschau für HEIC/RAW/Videos) – sonst eigene Dekodierung
//! (JPEG verkleinert schon beim Lesen, das ist bei 48-MP-Fotos sehr schnell).

use image::{imageops, DynamicImage, ImageBuffer, RgbImage};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, File};
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::SystemTime;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(windows)]
mod win;

/// Formate, die die eigene Dekodierung kann
const DECODABLE: &[&str] = &[".jpg", ".jpeg", ".jpe", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"];

fn is_jpeg(ext: &str) -> bool {
    matches!(ext, ".jpg" | ".jpeg" | ".jpe")
}

/// JPEG mit Verkleinerung beim Dekodieren (1/2, 1/4, 1/8) lesen.
fn decode_jpeg_scaled(path: &Path, size: u32) -> Option<RgbImage> {
    let mut d = jpeg_decoder::Decoder::new(BufReader::new(File::open(path).ok()?));
    d.read_info().ok()?;
    let req = size.min(u16::MAX as u32) as u16;
    d.scale(req, req).ok()?;
    let pixels = d.decode().ok()?;
    let info = d.info()?;
    let (w, h) = (info.width as u32, info.height as u32);
    let rgb: Vec<u8> = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => pixels,
        jpeg_decoder::PixelFormat::L8 => pixels.iter().flat_map(|&l| [l, l, l]).collect(),
        jpeg_decoder::PixelFormat::L16 => pixels.chunks(2).flat_map(|c| [c[0], c[0], c[0]]).collect(),
        jpeg_decoder::PixelFormat::CMYK32 => pixels
            .chunks(4)
            .flat_map(|c| {
                // Adobe-CMYK ist meist invertiert gespeichert
                let k = c[3] as u32;
                [(c[0] as u32 * k / 255) as u8, (c[1] as u32 * k / 255) as u8, (c[2] as u32 * k / 255) as u8]
            })
            .collect(),
    };
    ImageBuffer::from_raw(w, h, rgb)
}

fn orient(img: DynamicImage, o: u32) -> DynamicImage {
    match o {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn fit(img: DynamicImage, size: u32) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    let m = w.max(h);
    if m <= size {
        return img;
    }
    let s = size as f64 / m as f64;
    let (nw, nh) = (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1));
    DynamicImage::ImageRgb8(imageops::resize(&img.to_rgb8(), nw, nh, imageops::FilterType::Triangle))
}

pub fn encode_jpeg(img: &DynamicImage, quality: u8) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let rgb = img.to_rgb8();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut Cursor::new(&mut out), quality)
        .encode_image(&DynamicImage::ImageRgb8(rgb))
        .ok()?;
    Some(out)
}

/// Eigene Dekodierung (alle Systeme).
fn decode_generic(path: &Path, ext: &str, size: u32) -> Option<DynamicImage> {
    if !DECODABLE.contains(&ext) {
        return None;
    }
    let img = if is_jpeg(ext) {
        match decode_jpeg_scaled(path, size) {
            Some(i) => DynamicImage::ImageRgb8(i),
            None => image::ImageReader::open(path).ok()?.with_guessed_format().ok()?.decode().ok()?,
        }
    } else {
        image::ImageReader::open(path).ok()?.with_guessed_format().ok()?.decode().ok()?
    };
    let o = if is_jpeg(ext) || matches!(ext, ".tif" | ".tiff" | ".webp" | ".png") { crate::exif::orientation(path) } else { 1 };
    Some(fit(orient(img, o), size))
}

/// Erzeugt ein JPEG mit höchstens `size` Pixeln Kantenlänge.
pub fn render(path: &Path, ext: &str, size: u32, quality: u8) -> Option<Vec<u8>> {
    #[cfg(target_os = "macos")]
    if let Some(b) = mac::thumbnail(path, size, quality) {
        return Some(b);
    }
    #[cfg(windows)]
    if !DECODABLE.contains(&ext) || matches!(ext, ".tif" | ".tiff") {
        if let Some(img) = win::thumbnail(path, size) {
            return encode_jpeg(&fit(img, size), quality);
        }
    }
    let img = decode_generic(path, ext, size)?;
    encode_jpeg(&img, quality)
}

// ------------------------------------------------------------------ Warteschlange

type Job = Box<dyn FnOnce() + Send>;

/// Neueste Anfragen zuerst (sichtbare Bilder beim Scrollen), begrenzte Parallelität.
pub struct Pool {
    q: Mutex<VecDeque<Job>>,
    cv: Condvar,
}

impl Pool {
    pub fn new(threads: usize) -> Arc<Pool> {
        let p = Arc::new(Pool { q: Mutex::new(VecDeque::new()), cv: Condvar::new() });
        for i in 0..threads {
            let p2 = p.clone();
            std::thread::Builder::new()
                .name(format!("thumbs-{i}"))
                .spawn(move || loop {
                    let job = {
                        let mut q = p2.q.lock().unwrap();
                        loop {
                            if let Some(j) = q.pop_back() {
                                break j;
                            }
                            q = p2.cv.wait(q).unwrap();
                        }
                    };
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                })
                .expect("Vorschau-Thread");
        }
        p
    }

    pub fn push(&self, job: Job) {
        let mut q = self.q.lock().unwrap();
        q.push_back(job);
        // Sehr alte Anfragen verwerfen (vom Scrollen überholt) – ihre Antwort fällt weg → 404
        while q.len() > 400 {
            q.pop_front();
        }
        self.cv.notify_one();
    }
}

// ------------------------------------------------------------------ Zwischenspeicher

pub struct Cache {
    pub thumb_dir: PathBuf,
    mem: Mutex<(HashMap<String, Arc<Vec<u8>>>, VecDeque<String>, usize)>,
}

const PREVIEW_MEM_MAX: usize = 160 * 1024 * 1024;

impl Cache {
    pub fn new(cache_dir: &Path) -> Cache {
        let thumb_dir = cache_dir.join("thumbs");
        let _ = fs::create_dir_all(&thumb_dir);
        Cache { thumb_dir, mem: Mutex::new((HashMap::new(), VecDeque::new(), 0)) }
    }

    pub fn key(file: &Path, extra: &str) -> Option<String> {
        let m = fs::metadata(file).ok()?;
        let mt = m.modified().ok()?.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_millis();
        let mut h = Sha1::new();
        h.update(format!("{}|{}|{}|{}", file.to_string_lossy(), m.len(), mt, extra));
        Some(hex::encode(h.finalize()))
    }

    pub fn thumb_path(&self, key: &str) -> PathBuf {
        self.thumb_dir.join(&key[..2]).join(format!("{key}.jpg"))
    }

    pub fn store_thumb(&self, key: &str, data: &[u8]) {
        let out = self.thumb_path(key);
        if let Some(p) = out.parent() {
            let _ = fs::create_dir_all(p);
        }
        let tmp = out.with_extension(format!("{}.tmp", std::process::id()));
        if fs::write(&tmp, data).is_ok() {
            let _ = fs::rename(&tmp, &out);
        }
    }

    pub fn mem_get(&self, key: &str) -> Option<Arc<Vec<u8>>> {
        let mut g = self.mem.lock().unwrap();
        let v = g.0.get(key).cloned()?;
        // zuletzt benutzt ans Ende
        if let Some(i) = g.1.iter().position(|k| k == key) {
            let k = g.1.remove(i).unwrap();
            g.1.push_back(k);
        }
        Some(v)
    }

    pub fn mem_put(&self, key: String, data: Arc<Vec<u8>>) {
        let mut g = self.mem.lock().unwrap();
        if g.0.contains_key(&key) {
            return;
        }
        g.2 += data.len();
        g.0.insert(key.clone(), data);
        g.1.push_back(key);
        while g.2 > PREVIEW_MEM_MAX && g.1.len() > 1 {
            if let Some(k) = g.1.pop_front() {
                if let Some(v) = g.0.remove(&k) {
                    g.2 -= v.len();
                }
            }
        }
    }

    /// Zwischenspeicher begrenzen (älteste Dateien zuerst entfernen).
    pub fn trim(&self, max_bytes: u64) {
        let mut files = Vec::new();
        if let Ok(subs) = fs::read_dir(&self.thumb_dir) {
            for s in subs.flatten() {
                if let Ok(rd) = fs::read_dir(s.path()) {
                    for f in rd.flatten() {
                        if let Ok(m) = f.metadata() {
                            let t = m.accessed().ok().max(m.modified().ok()).unwrap_or(SystemTime::UNIX_EPOCH);
                            files.push((f.path(), m.len(), t));
                        }
                    }
                }
            }
        }
        let mut total: u64 = files.iter().map(|f| f.1).sum();
        files.sort_by_key(|f| f.2);
        let fresh = SystemTime::now() - std::time::Duration::from_secs(300); // gerade erzeugte behalten
        for (p, size, t) in files {
            if total <= max_bytes || t > fresh {
                break;
            }
            if fs::remove_file(&p).is_ok() {
                total -= size;
            }
        }
    }

    pub fn clear(&self) {
        let _ = fs::remove_dir_all(&self.thumb_dir);
        let _ = fs::create_dir_all(&self.thumb_dir);
        let mut g = self.mem.lock().unwrap();
        *g = (HashMap::new(), VecDeque::new(), 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn renders_rotated_downscaled_jpeg() {
        let dir = std::env::temp_dir().join(format!("slimsort-thumb-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.jpg");
        let img = DynamicImage::ImageRgb8(ImageBuffer::from_fn(1200, 800, |x, _| Rgb([(x % 255) as u8, 80, 160])));
        fs::write(&p, encode_jpeg(&img, 90).unwrap()).unwrap();
        let out = render(&p, ".jpg", 300, 80).unwrap();
        let back = image::load_from_memory(&out).unwrap();
        assert_eq!((back.width(), back.height()), (300, 200));
    }
}
