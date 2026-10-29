//! macOS: Vorschaubilder über ImageIO – schnell, dreht richtig, kann HEIC und RAW.
//! Videos (und was ImageIO sonst nicht kann) über Quick Look, wie im Finder.

use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::CFURL;
use core_foundation_sys::base::{CFRelease, CFTypeRef};
use core_foundation_sys::data::{CFDataCreateMutable, CFDataGetBytePtr, CFDataGetLength, CFMutableDataRef};
use core_foundation_sys::dictionary::CFDictionaryRef;
use core_foundation_sys::url::CFURLRef;
use std::ffi::c_void;
use std::path::Path;

type CGImageSourceRef = *const c_void;
type CGImageRef = *const c_void;
type CGImageDestinationRef = *const c_void;

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageSourceCreateWithURL(url: CFURLRef, options: CFDictionaryRef) -> CGImageSourceRef;
    fn CGImageSourceCreateThumbnailAtIndex(src: CGImageSourceRef, index: usize, options: CFDictionaryRef) -> CGImageRef;
    fn CGImageDestinationCreateWithData(data: CFMutableDataRef, kind: CFStringRef, count: usize, options: CFDictionaryRef) -> CGImageDestinationRef;
    fn CGImageDestinationAddImage(dest: CGImageDestinationRef, image: CGImageRef, props: CFDictionaryRef);
    fn CGImageDestinationFinalize(dest: CGImageDestinationRef) -> bool;
    static kCGImageSourceCreateThumbnailFromImageAlways: CFStringRef;
    static kCGImageSourceThumbnailMaxPixelSize: CFStringRef;
    static kCGImageSourceCreateThumbnailWithTransform: CFStringRef;
    static kCGImageSourceShouldCacheImmediately: CFStringRef;
    static kCGImageDestinationLossyCompressionQuality: CFStringRef;
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

#[link(name = "QuickLook", kind = "framework")]
extern "C" {
    fn QLThumbnailImageCreate(alloc: *const c_void, url: CFURLRef, max: CGSize, options: CFDictionaryRef) -> CGImageRef;
}

/// Gibt ein CoreFoundation-Objekt frei, sobald es nicht mehr gebraucht wird.
struct Owned(CFTypeRef);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: Das Objekt stammt aus einer Create-Funktion und gehört uns.
            unsafe { CFRelease(self.0) }
        }
    }
}

pub fn thumbnail(path: &Path, size: u32, quality: u8) -> Option<Vec<u8>> {
    let url = CFURL::from_path(path, false)?;
    // SAFETY: Alle Aufrufe bekommen gültige CF-Objekte; Rückgaben werden auf null geprüft und freigegeben.
    unsafe {
        let src = Owned(CGImageSourceCreateWithURL(url.as_concrete_TypeRef(), std::ptr::null()));
        if src.0.is_null() {
            return None;
        }
        let key = |k: CFStringRef| CFString::wrap_under_get_rule(k);
        let opts: CFDictionary<CFString, CFType> = CFDictionary::from_CFType_pairs(&[
            (key(kCGImageSourceCreateThumbnailFromImageAlways), CFBoolean::true_value().as_CFType()),
            (key(kCGImageSourceCreateThumbnailWithTransform), CFBoolean::true_value().as_CFType()),
            (key(kCGImageSourceShouldCacheImmediately), CFBoolean::true_value().as_CFType()),
            (key(kCGImageSourceThumbnailMaxPixelSize), CFNumber::from(size as i64).as_CFType()),
        ]);
        let img = Owned(CGImageSourceCreateThumbnailAtIndex(src.0, 0, opts.as_concrete_TypeRef()));
        if img.0.is_null() {
            return None;
        }
        encode(img.0, quality)
    }
}

/// Quick Look: Standbild aus Videos (und anderen Dateien, die ImageIO nicht öffnet)
pub fn quicklook(path: &Path, size: u32, quality: u8) -> Option<Vec<u8>> {
    let url = CFURL::from_path(path, false)?;
    // SAFETY: gültige CF-Objekte; das Ergebnis wird auf null geprüft und freigegeben.
    unsafe {
        let img = Owned(QLThumbnailImageCreate(std::ptr::null(), url.as_concrete_TypeRef(), CGSize { width: size as f64, height: size as f64 }, std::ptr::null()));
        if img.0.is_null() {
            return None;
        }
        encode(img.0, quality)
    }
}

/// CGImage → JPEG
fn encode(img: CGImageRef, quality: u8) -> Option<Vec<u8>> {
    // SAFETY: img ist ein gültiges CGImage; alle CF-Objekte werden geprüft und freigegeben.
    unsafe {
        let key = |k: CFStringRef| CFString::wrap_under_get_rule(k);
        let data = CFDataCreateMutable(std::ptr::null(), 0);
        if data.is_null() {
            return None;
        }
        let data_owner = Owned(data as CFTypeRef);
        let kind = CFString::from_static_string("public.jpeg");
        let dest = Owned(CGImageDestinationCreateWithData(data, kind.as_concrete_TypeRef(), 1, std::ptr::null()));
        if dest.0.is_null() {
            return None;
        }
        let props: CFDictionary<CFString, CFType> =
            CFDictionary::from_CFType_pairs(&[(key(kCGImageDestinationLossyCompressionQuality), CFNumber::from(quality as f64 / 100.0).as_CFType())]);
        CGImageDestinationAddImage(dest.0, img, props.as_concrete_TypeRef());
        if !CGImageDestinationFinalize(dest.0) {
            return None;
        }
        let len = CFDataGetLength(data) as usize;
        let ptr = CFDataGetBytePtr(data);
        if ptr.is_null() || len == 0 {
            return None;
        }
        let out = std::slice::from_raw_parts(ptr, len).to_vec();
        drop(data_owner);
        Some(out)
    }
}
