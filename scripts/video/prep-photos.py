"""Bereitet eigene Fotos für die Video-Aufnahmen vor.

  python3 prep-photos.py QUELLORDNER ZIEL --sort   → alle Fotos (2× gemischt) als IMG_5001.JPG … mit Aufnahmezeit
  python3 prep-photos.py QUELLORDNER ZIEL --series DATEI → aus einem Foto eine Serie (5 Aufnahmen, eine verwackelt) + ein paar Einzelfotos
"""
import os, sys, random, datetime
from PIL import Image, ImageFilter, ImageEnhance

src, out, mode = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
files = sorted(f for f in os.listdir(src) if f.lower().endswith(('.jpg', '.jpeg', '.png')))


def load(name):
    im = Image.open(os.path.join(src, name)).convert('RGB')
    im.thumbnail((2200, 2200), Image.LANCZOS)
    return im


def save(im, name, t):
    exif = Image.Exif()
    exif[0x8769] = {0x9003: t.strftime('%Y:%m:%d %H:%M:%S'), 0x9291: f'{t.microsecond // 1000:03d}'}
    p = os.path.join(out, name)
    im.save(p, quality=90, exif=exif)
    os.utime(p, (t.timestamp(), t.timestamp()))


rnd = random.Random(5)
t = datetime.datetime(2025, 7, 12, 8, 30)
if mode == '--sort':
    order = files[:]
    rnd.shuffle(order)
    second = files[:]
    rnd.shuffle(second)
    n = 0
    for f in order + second:
        n += 1
        t += datetime.timedelta(minutes=rnd.randint(20, 90))
        im = load(f)
        if n > len(files):  # zweite Runde leicht anders zuschneiden, damit es nicht identisch wirkt
            w, h = im.size
            im = im.crop((int(w * 0.06), int(h * 0.04), int(w * 0.97), int(h * 0.98)))
        save(im, f'IMG_{5000 + n:04d}.JPG', t)
else:
    base = load(sys.argv[4])
    w, h = base.size
    for k in range(5):
        dx, dy = k * 0.012, k * 0.006
        im = base.crop((int(w * (0.03 + dx)), int(h * (0.02 + dy)), int(w * (0.93 + dx)), int(h * (0.92 + dy))))
        if k == 1:
            im = im.filter(ImageFilter.GaussianBlur(6))  # verwackelt
        if k == 3:
            im = ImageEnhance.Brightness(im).enhance(0.72)  # zu dunkel
        save(im, f'IMG_{6001 + k:04d}.JPG', t + datetime.timedelta(seconds=k * 0.6))
    others = [f for f in files if f != os.path.basename(sys.argv[4])]
    for i, f in enumerate(others[:6]):
        t += datetime.timedelta(minutes=40)
        save(load(f), f'IMG_{6010 + i:04d}.JPG', t)
print('ok')
