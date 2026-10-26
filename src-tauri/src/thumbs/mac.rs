//! macOS: Vorschaubilder über ImageIO (wie Quick Look) – schnell, dreht richtig, kann HEIC und RAW.

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
        CGImageDestinationAddImage(dest.0, img.0, props.as_concrete_TypeRef());
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
