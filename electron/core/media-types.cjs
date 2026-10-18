'use strict';

const IMAGE_EXT = new Set([
  '.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp',
  '.tif', '.tiff', '.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.raf', '.orf', '.rw2',
  '.pef', '.srw',
]);
const VIDEO_EXT = new Set([
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp', '.mts', '.m2ts', '.wmv', '.mpg', '.mpeg',
]);
const SIDECAR_EXT = new Set(['.xmp', '.aae', '.thm']);
/** Formate, die der eingebaute Browser direkt anzeigen kann. */
const BROWSER_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp', '.avif', '.bmp']);
const BROWSER_VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const LIVE_IMAGE_EXT = new Set(['.heic', '.heif', '.jpg', '.jpeg']);
const LIVE_VIDEO_EXT = new Set(['.mov', '.mp4']);
/** Live-Photo-Videos sind kurz (ca. 3 s) und daher klein. */
const LIVE_VIDEO_MAX_BYTES = 25 * 1024 * 1024;

/** Ordner, die nie durchsucht werden (System- und NAS-Hilfsordner). */
const SKIP_DIRS = new Set([
  '@eadir', '.@__thumb', '@recycle', '#recycle', '$recycle.bin', 'system volume information',
  '.trashes', '.spotlight-v100', '.fseventsd', '@recently-snapshot', '.thumbnails', 'node_modules',
]);

function kindOf(ext) {
  const e = ext.toLowerCase();
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (SIDECAR_EXT.has(e)) return 'sidecar';
  return null;
}

module.exports = {
  IMAGE_EXT,
  VIDEO_EXT,
  SIDECAR_EXT,
  BROWSER_IMAGE_EXT,
  BROWSER_VIDEO_EXT,
  LIVE_IMAGE_EXT,
  LIVE_VIDEO_EXT,
  LIVE_VIDEO_MAX_BYTES,
  SKIP_DIRS,
  kindOf,
};
