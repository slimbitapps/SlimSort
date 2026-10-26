/// <reference lib="webworker" />
/**
 * HEIC/HEIF (iPhone-Fotos) selbst dekodieren – nur als Ersatz, wenn das Betriebssystem
 * keine Vorschau liefern kann (z. B. Windows ohne HEIF-Erweiterung).
 */
import libheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

let lib: any = null;

self.onmessage = async (e: MessageEvent<{ id: number; url: string; size: number }>) => {
  const { id, url, size } = e.data;
  try {
    lib ??= await libheif();
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const decoder = new lib.HeifDecoder();
    const images = decoder.decode(buf);
    if (!images || !images.length) throw new Error('keine Bilder');
    const im = images[0];
    const w = im.get_width();
    const h = im.get_height();
    const rgba: Uint8ClampedArray = await new Promise((res, rej) =>
      im.display({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }, (d: any) => (d ? res(d.data) : rej(new Error('display'))))
    );
    for (const x of images) x.free?.();
    const bmp = await createImageBitmap(new ImageData(rgba as any, w, h));
    const s = Math.min(1, size / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s));
    const ch = Math.max(1, Math.round(h * s));
    const canvas = new OffscreenCanvas(cw, ch);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, cw, ch);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
    (self as unknown as Worker).postMessage({ id, ok: true, blob });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
