//! Einstellungen als JSON-Datei im Benutzerordner der App (bleibt lokal).

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct SettingsStore {
    file: PathBuf,
    pub data: Mutex<Value>,
    writing: Mutex<()>,
}

impl SettingsStore {
    pub fn load(file: PathBuf) -> SettingsStore {
        let read = |p: &PathBuf| fs::read_to_string(p).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).filter(Value::is_object);
        // Beschädigte Datei? Sicherung versuchen.
        let data = read(&file).or_else(|| read(&file.with_extension("json.bak"))).unwrap_or_else(|| Value::Object(Default::default()));
        SettingsStore { file, data: Mutex::new(data), writing: Mutex::new(()) }
    }

    pub fn get(&self) -> Value {
        self.data.lock().unwrap().clone()
    }

    /// Speichert sicher: erst in eine temporäre Datei, alte Fassung als .bak behalten.
    pub fn save(&self, data: Value) {
        *self.data.lock().unwrap() = data.clone();
        let _w = self.writing.lock().unwrap();
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let Ok(json) = serde_json::to_string_pretty(&data) else { return };
        let tmp = self.file.with_extension("json.tmp");
        if fs::write(&tmp, json).is_ok() {
            let _ = fs::copy(&self.file, self.file.with_extension("json.bak"));
            let _ = fs::rename(&tmp, &self.file);
        }
    }

    /// Einzelnen Wert setzen (z. B. Fensterposition) und speichern.
    pub fn set_key(&self, key: &str, v: Value) {
        let mut d = self.get();
        if let Value::Object(m) = &mut d {
            m.insert(key.into(), v);
        }
        self.save(d);
    }
}
