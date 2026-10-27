//! Wie stark ist dieser Computer? (für die Empfehlung der KI-Stufe)

use serde::Serialize;
use std::sync::OnceLock;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    /// Arbeitsspeicher in GB
    pub ram_gb: f32,
    /// echte Prozessorkerne
    pub cores: usize,
    /// kann das Sprachmodell laufen? (x86: braucht AVX2, sonst Apple-Chip)
    pub chat_ok: bool,
    /// Apple-Chip (Grafikkarte wird mitbenutzt)
    pub apple_gpu: bool,
    /// empfohlene Stufe: eco / balanced / max
    pub recommended: &'static str,
}

fn ram_bytes() -> u64 {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|s| s.lines().find(|l| l.starts_with("MemTotal:")).and_then(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok()))
            .map(|kb| kb * 1024)
            .unwrap_or(0)
    }
    #[cfg(target_os = "macos")]
    unsafe {
        let mut v: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = c"hw.memsize";
        if libc::sysctlbyname(name.as_ptr(), &mut v as *mut u64 as *mut libc::c_void, &mut len, std::ptr::null_mut(), 0) == 0 {
            v
        } else {
            0
        }
    }
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        if GlobalMemoryStatusEx(&mut m).is_ok() {
            m.ullTotalPhys
        } else {
            0
        }
    }
}

fn chat_cpu_ok() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        // Das Helfer-Programm gibt es für Windows, Mac und Linux (x86_64 mit AVX2)
        std::is_x86_feature_detected!("avx2") && std::is_x86_feature_detected!("fma")
    }
    #[cfg(target_arch = "aarch64")]
    {
        cfg!(target_os = "macos")
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        false
    }
}

pub fn detect() -> Hardware {
    static HW: OnceLock<Hardware> = OnceLock::new();
    HW.get_or_init(|| {
        let ram_gb = ram_bytes() as f32 / (1u64 << 30) as f32;
        let cores = num_cpus::get_physical().max(1);
        let chat_ok = chat_cpu_ok();
        let apple_gpu = cfg!(all(target_os = "macos", target_arch = "aarch64"));
        let recommended = if !chat_ok || ram_gb < 7.5 {
            "eco"
        } else if ram_gb >= 15.0 && (cores >= 8 || apple_gpu) {
            "max"
        } else {
            "balanced"
        };
        Hardware { ram_gb: (ram_gb * 10.0).round() / 10.0, cores, chat_ok, apple_gpu, recommended }
    })
    .clone()
}
