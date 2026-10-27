//! Gesichter finden (YuNet) und wiedererkennbar beschreiben (SFace) – beides kleine,
//! frei nutzbare Modelle aus dem OpenCV Zoo, ausgeführt mit tract (reines Rust).
//!
//! Ablauf wie bei OpenCV: Bild auf 640 × 640 bringen → Gesichter mit 5 Punkten (Augen, Nase,
//! Mundwinkel) → Gesicht anhand der Punkte gerade ausrichten (112 × 112) → 128 Zahlen,
//! die für dieselbe Person sehr ähnlich sind.

use tract_onnx::prelude::*;

type Plan = std::sync::Arc<TypedRunnableModel>;

pub struct Faces {
    det: Plan,
    emb: Plan,
}

pub struct Face {
    pub bbox: [f32; 4],
    pub kps: [f32; 10],
    pub score: f32,
    pub emb: Vec<f32>,
}

const SIZE: usize = 640;
/// Zielpunkte für das ausgerichtete Gesicht (wie ArcFace/SFace)
const TEMPLATE: [[f32; 2]; 5] = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

impl Faces {
    pub fn load(det: &str, emb: &str) -> TractResult<Faces> {
        let det = tract_onnx::onnx()
            .model_for_path(det)?
            .with_input_fact(0, f32::fact([1, 3, SIZE, SIZE]).into())?
            .into_optimized()?
            .into_runnable()?;
        let emb = tract_onnx::onnx()
            .model_for_path(emb)?
            .with_input_fact(0, f32::fact([1, 3, 112, 112]).into())?
            .into_optimized()?
            .into_runnable()?;
        Ok(Faces { det, emb })
    }

    /// Alle Gesichter in einem RGB-Bild
    pub fn detect(&self, img: &image::RgbImage, min_score: f32) -> TractResult<Vec<Face>> {
        let (w, h) = (img.width() as f32, img.height() as f32);
        let ratio = (SIZE as f32 / w.max(h)).min(1e9);
        let (nw, nh) = (((w * ratio).round() as u32).max(1), ((h * ratio).round() as u32).max(1));
        let small = image::imageops::resize(img, nw, nh, image::imageops::FilterType::Triangle);
        // YuNet erwartet BGR, Werte 0–255, Rest schwarz auffüllen
        let input: Tensor = tract_ndarray::Array4::<f32>::from_shape_fn((1, 3, SIZE, SIZE), |(_, c, y, x)| {
            if x < nw as usize && y < nh as usize {
                small.get_pixel(x as u32, y as u32)[2 - c] as f32
            } else {
                0.0
            }
        })
        .into();
        let out = self.det.run(tvec!(input.into()))?;
        let view = |i: usize| out[i].to_plain_array_view::<f32>().map(|a| a.iter().copied().collect::<Vec<f32>>());
        let mut cands = Vec::new();
        for (si, stride) in [8usize, 16, 32].into_iter().enumerate() {
            let (cls, obj, bb, kp) = (view(si)?, view(3 + si)?, view(6 + si)?, view(9 + si)?);
            let cols = SIZE / stride;
            for idx in 0..cls.len() {
                let score = (cls[idx].clamp(0.0, 1.0) * obj[idx].clamp(0.0, 1.0)).sqrt();
                if score < min_score {
                    continue;
                }
                let (r, c) = ((idx / cols) as f32, (idx % cols) as f32);
                let s = stride as f32;
                let cx = (c + bb[idx * 4]) * s;
                let cy = (r + bb[idx * 4 + 1]) * s;
                let bw = bb[idx * 4 + 2].exp() * s;
                let bh = bb[idx * 4 + 3].exp() * s;
                let mut kps = [0f32; 10];
                for n in 0..5 {
                    kps[n * 2] = (kp[idx * 10 + n * 2] + c) * s / ratio;
                    kps[n * 2 + 1] = (kp[idx * 10 + n * 2 + 1] + r) * s / ratio;
                }
                cands.push(Face { bbox: [(cx - bw / 2.0) / ratio, (cy - bh / 2.0) / ratio, bw / ratio, bh / ratio], kps, score, emb: vec![] });
            }
        }
        // überlappende Treffer zusammenfassen (NMS)
        cands.sort_by(|a, b| b.score.total_cmp(&a.score));
        let mut keep: Vec<Face> = Vec::new();
        for f in cands {
            if keep.iter().all(|k| iou(&k.bbox, &f.bbox) < 0.3) {
                keep.push(f);
            }
        }
        for f in keep.iter_mut() {
            f.emb = self.embed(img, &f.kps)?;
        }
        Ok(keep)
    }

    /// Gesicht anhand der 5 Punkte ausrichten und beschreiben (128 Zahlen)
    fn embed(&self, img: &image::RgbImage, kps: &[f32; 10]) -> TractResult<Vec<f32>> {
        let m = similarity(kps);
        // Umkehrung, um für jeden Zielpunkt die Stelle im Originalbild zu finden
        let det = m[0] * m[4] - m[1] * m[3];
        let inv = [m[4] / det, -m[1] / det, (m[1] * m[5] - m[4] * m[2]) / det, -m[3] / det, m[0] / det, (m[3] * m[2] - m[0] * m[5]) / det];
        let (w, h) = (img.width() as f32, img.height() as f32);
        let px = |x: f32, y: f32, c: usize| -> f32 {
            if x < 0.0 || y < 0.0 || x > w - 1.0 || y > h - 1.0 {
                return 0.0;
            }
            let (x0, y0) = (x.floor(), y.floor());
            let (x1, y1) = ((x0 + 1.0).min(w - 1.0), (y0 + 1.0).min(h - 1.0));
            let (fx, fy) = (x - x0, y - y0);
            let g = |xx: f32, yy: f32| img.get_pixel(xx as u32, yy as u32)[c] as f32;
            g(x0, y0) * (1.0 - fx) * (1.0 - fy) + g(x1, y0) * fx * (1.0 - fy) + g(x0, y1) * (1.0 - fx) * fy + g(x1, y1) * fx * fy
        };
        // SFace erwartet RGB, Werte 0–255
        let input: Tensor = tract_ndarray::Array4::<f32>::from_shape_fn((1, 3, 112, 112), |(_, c, y, x)| {
            let (xf, yf) = (x as f32, y as f32);
            px(inv[0] * xf + inv[1] * yf + inv[2], inv[3] * xf + inv[4] * yf + inv[5], c)
        })
        .into();
        let out = self.emb.run(tvec!(input.into()))?;
        Ok(out[0].to_plain_array_view::<f32>()?.iter().copied().collect())
    }
}

/// Ähnlichkeitsabbildung (Drehen, Skalieren, Verschieben) von den 5 Punkten auf die Vorlage,
/// kleinste Fehlerquadrate. Ergebnis: [a, -b, tx, b, a, ty]
fn similarity(kps: &[f32; 10]) -> [f32; 6] {
    let (mut pmx, mut pmy, mut qmx, mut qmy) = (0.0, 0.0, 0.0, 0.0);
    for i in 0..5 {
        pmx += kps[i * 2] / 5.0;
        pmy += kps[i * 2 + 1] / 5.0;
        qmx += TEMPLATE[i][0] / 5.0;
        qmy += TEMPLATE[i][1] / 5.0;
    }
    let (mut num_a, mut num_b, mut den) = (0.0, 0.0, 0.0);
    for i in 0..5 {
        let (px, py) = (kps[i * 2] - pmx, kps[i * 2 + 1] - pmy);
        let (qx, qy) = (TEMPLATE[i][0] - qmx, TEMPLATE[i][1] - qmy);
        num_a += px * qx + py * qy;
        num_b += px * qy - py * qx;
        den += px * px + py * py;
    }
    let (a, b) = (num_a / den, num_b / den);
    [a, -b, qmx - (a * pmx - b * pmy), b, a, qmy - (b * pmx + a * pmy)]
}

fn iou(a: &[f32; 4], b: &[f32; 4]) -> f32 {
    let (x1, y1) = (a[0].max(b[0]), a[1].max(b[1]));
    let (x2, y2) = ((a[0] + a[2]).min(b[0] + b[2]), (a[1] + a[3]).min(b[1] + b[3]));
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    inter / (a[2] * a[3] + b[2] * b[3] - inter).max(1e-6)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vergleich mit OpenCV: FACES_DIR=<ordner aus dem Release> cargo test --release -- --nocapture
    #[test]
    fn matches_opencv() {
        let Ok(dir) = std::env::var("FACES_DIR") else { return };
        let p = |n: &str| format!("{dir}/{n}");
        let f = Faces::load(&p("slimsort-face-detect.onnx"), &p("slimsort-face-embed.onnx")).unwrap();
        let r: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p("slimsort-face-ref.json")).unwrap()).unwrap();
        let mut embs = Vec::new();
        for n in ["astronaut.png", "zwei.png"] {
            let img = image::open(p(&format!("slimsort-face-test-{n}"))).unwrap().to_rgb8();
            let t0 = std::time::Instant::now();
            let faces = f.detect(&img, 0.6).unwrap();
            let want = r[n].as_array().unwrap();
            println!("{n}: {} Gesichter (OpenCV {}), {:?}", faces.len(), want.len(), t0.elapsed());
            assert_eq!(faces.len(), want.len());
            for w in want {
                let wb: Vec<f32> = w["box"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
                let best = faces.iter().max_by(|a, b| iou(&a.bbox, &[wb[0], wb[1], wb[2], wb[3]]).total_cmp(&iou(&b.bbox, &[wb[0], wb[1], wb[2], wb[3]]))).unwrap();
                let io = iou(&best.bbox, &[wb[0], wb[1], wb[2], wb[3]]);
                let we: Vec<f32> = w["emb"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
                let cos = cos(&best.emb, &we);
                println!("  Kasten-Überlappung {io:.3}, Beschreibung cos {cos:.3}");
                assert!(io > 0.8, "Kasten weicht ab");
                assert!(cos > 0.9, "Beschreibung weicht ab");
                embs.push(best.emb.clone());
            }
        }
        // gleiche Person (Astronautin groß/klein) sehr ähnlich
        let c = cos(&embs[1], &embs[2]);
        println!("gleiche Person groß/klein: cos {c:.3}");
        assert!(c > 0.6);
    }

    fn cos(a: &[f32], b: &[f32]) -> f32 {
        let d: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        d / (a.iter().map(|x| x * x).sum::<f32>().sqrt() * b.iter().map(|x| x * x).sum::<f32>().sqrt())
    }
}
