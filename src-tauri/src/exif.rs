//! Fotodaten (EXIF): Aufnahmezeit (für Sortierung und Serien) und Details für die Info-Anzeige.

use chrono::{Local, NaiveDate, TimeZone};
use exif::{In, Reader, Tag, Value as EV};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const EXIF_EXT: &[&str] = &[
    ".jpg", ".jpeg", ".jpe", ".heic", ".heif", ".tif", ".tiff", ".dng", ".cr2", ".nef", ".arw", ".orf", ".rw2", ".raf", ".pef", ".srw",
    ".png", ".webp", ".avif",
];

fn read(path: &Path) -> Option<exif::Exif> {
    let f = File::open(path).ok()?;
    Reader::new().read_from_container(&mut BufReader::new(f)).ok()
}

fn ascii(e: &exif::Exif, tag: Tag) -> Option<Vec<u8>> {
    match &e.get_field(tag, In::PRIMARY)?.value {
        EV::Ascii(v) => v.first().cloned(),
        _ => None,
    }
}

/// Aufnahmezeit (ms seit 1970, Ortszeit wie in der Kamera), auf Sekundenbruchteile genau.
pub fn capture_time_of(e: &exif::Exif) -> Option<f64> {
    let (raw, sub_tag) = match ascii(e, Tag::DateTimeOriginal) {
        Some(r) => (r, Tag::SubSecTimeOriginal),
        None => (ascii(e, Tag::DateTimeDigitized)?, Tag::SubSecTimeDigitized),
    };
    let dt = exif::DateTime::from_ascii(&raw).ok()?;
    let date = NaiveDate::from_ymd_opt(dt.year as i32, dt.month as u32, dt.day as u32)?;
    let naive = date.and_hms_opt(dt.hour as u32, dt.minute as u32, dt.second as u32)?;
    let local = Local.from_local_datetime(&naive).earliest()?;
    let mut ms = local.timestamp_millis() as f64;
    let sub = ascii(e, sub_tag).or_else(|| ascii(e, Tag::SubSecTimeDigitized));
    if let Some(s) = sub {
        let s = String::from_utf8_lossy(&s).trim().to_string();
        if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(frac) = format!("0.{s}").parse::<f64>() {
                ms += (frac * 1000.0).round();
            }
        }
    }
    Some(ms)
}

pub fn capture_time(path: &Path, ext: &str) -> Option<f64> {
    if !EXIF_EXT.contains(&ext) {
        return None;
    }
    capture_time_of(&read(path)?)
}

/// Liest Aufnahmezeiten im Hintergrund und meldet sie in Paketen.
pub fn read_capture_times(items: Vec<(u64, std::path::PathBuf, String)>, on_batch: impl Fn(Vec<(u64, f64)>) + Send + Sync + 'static, is_cancelled: impl Fn() -> bool + Send + Sync + 'static) {
    let items = Arc::new(items);
    let next = Arc::new(AtomicUsize::new(0));
    let batch = Arc::new(Mutex::new((Vec::<(u64, f64)>::new(), Instant::now())));
    let on_batch = Arc::new(on_batch);
    let is_cancelled = Arc::new(is_cancelled);
    let workers: Vec<_> = (0..6)
        .map(|_| {
            let (items, next, batch, on_batch, is_cancelled) = (items.clone(), next.clone(), batch.clone(), on_batch.clone(), is_cancelled.clone());
            std::thread::spawn(move || loop {
                if is_cancelled() {
                    return;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some((id, path, ext)) = items.get(i) else { return };
                if let Some(t) = capture_time(path, ext) {
                    let mut b = batch.lock().unwrap();
                    b.0.push((*id, t));
                    if b.0.len() >= 500 || b.1.elapsed() > Duration::from_millis(400) {
                        let out = std::mem::take(&mut b.0);
                        b.1 = Instant::now();
                        drop(b);
                        on_batch(out);
                    }
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
    let rest = std::mem::take(&mut batch.lock().unwrap().0);
    if !rest.is_empty() && !is_cancelled() {
        on_batch(rest);
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoInfo {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub taken: Option<f64>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub focal: Option<String>,
    pub aperture: Option<String>,
    pub exposure: Option<String>,
    pub iso: Option<String>,
    pub flash: Option<bool>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

fn text(e: &exif::Exif, tag: Tag) -> Option<String> {
    let s = ascii(e, tag).map(|v| String::from_utf8_lossy(&v).trim().trim_end_matches('\0').trim().to_string())?;
    (!s.is_empty()).then_some(s)
}

fn rational(e: &exif::Exif, tag: Tag) -> Option<f64> {
    match &e.get_field(tag, In::PRIMARY)?.value {
        EV::Rational(v) => v.first().map(|r| r.to_f64()),
        EV::SRational(v) => v.first().map(|r| r.to_f64()),
        _ => None,
    }
}

fn uint(e: &exif::Exif, tag: Tag) -> Option<u32> {
    e.get_field(tag, In::PRIMARY)?.value.get_uint(0)
}

fn gps(e: &exif::Exif, tag: Tag, ref_tag: Tag) -> Option<f64> {
    let v = match &e.get_field(tag, In::PRIMARY)?.value {
        EV::Rational(v) if v.len() >= 3 => v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0,
        _ => return None,
    };
    let r = text(e, ref_tag).unwrap_or_default();
    Some(if r.starts_with('S') || r.starts_with('W') { -v } else { v })
}

fn trim_num(x: f64) -> String {
    let s = format!("{x:.1}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Details für die Info-Anzeige (nur, was vorhanden ist).
pub fn photo_info(path: &Path) -> PhotoInfo {
    let mut info = PhotoInfo::default();
    if let Ok((w, h)) = image::image_dimensions(path) {
        info.width = Some(w);
        info.height = Some(h);
    }
    let Some(e) = read(path) else { return info };
    info.taken = capture_time_of(&e);
    let make = text(&e, Tag::Make).unwrap_or_default();
    let model = text(&e, Tag::Model).unwrap_or_default();
    // "Canon" + "Canon EOS R6" -> "Canon EOS R6"; "Apple" + "iPhone 15" -> "Apple iPhone 15"
    let brand = make.split_whitespace().next().unwrap_or("").to_lowercase();
    info.camera = if model.is_empty() {
        (!make.is_empty()).then_some(make)
    } else if brand.is_empty() || model.to_lowercase().starts_with(&brand) {
        Some(model)
    } else {
        Some(format!("{make} {model}"))
    };
    info.lens = text(&e, Tag::LensModel);
    info.focal = rational(&e, Tag::FocalLength).map(|f| format!("{} mm", trim_num(f)));
    info.aperture = rational(&e, Tag::FNumber).map(|f| format!("f/{}", trim_num(f)));
    info.exposure = rational(&e, Tag::ExposureTime).map(|t| if t >= 1.0 { format!("{} s", trim_num(t)) } else { format!("1/{} s", (1.0 / t).round()) });
    info.iso = uint(&e, Tag::PhotographicSensitivity).map(|i| format!("ISO {i}"));
    info.flash = uint(&e, Tag::Flash).map(|f| f & 1 == 1);
    if info.width.is_none() {
        info.width = uint(&e, Tag::PixelXDimension);
        info.height = uint(&e, Tag::PixelYDimension);
    }
    info.lat = gps(&e, Tag::GPSLatitude, Tag::GPSLatitudeRef);
    info.lon = gps(&e, Tag::GPSLongitude, Tag::GPSLongitudeRef);
    info
}

/// EXIF-Ausrichtung (1–8) für die Vorschaubilder.
pub fn orientation(path: &Path) -> u32 {
    read(path).and_then(|e| uint(&e, Tag::Orientation)).unwrap_or(1)
}
