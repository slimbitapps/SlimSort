"""Erzeugt Testfotos (mit EXIF-Aufnahmezeit, auf Sekundenbruchteile) und Testvideos.

  python3 make-fixtures.py ZIEL            -> 40 Fotos in 8 Serien à 5 (+ Live Photo, Video)
  python3 make-fixtures.py ZIEL --simple 3 DSC   -> 3 einzelne Fotos ohne Serien

Serien: 5 Fotos im Abstand von 0,4 s mit gleichem Motiv (leicht verschoben).
Das 2. Foto jeder Serie ist unscharf, Foto 9 zeigt ein ganz anderes Motiv.
"""
import os, sys, random, subprocess, datetime
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
palette = [(91, 140, 255), (47, 191, 113), (245, 165, 36), (239, 79, 95), (166, 108, 255), (24, 184, 201), (255, 122, 182), (120, 130, 150)]
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 90)
except Exception:
    font = ImageFont.load_default()


def scene(seed, w, h, dx=0, dy=0):
    rnd = random.Random(seed)
    c = palette[seed % len(palette)]
    img = Image.new('RGB', (w, h), c)
    d = ImageDraw.Draw(img)
    for _ in range(16):
        x, y = rnd.randint(0, w) + dx, rnd.randint(0, h) + dy
        r = rnd.randint(40, 260)
        cc = tuple(min(255, max(0, v + rnd.randint(-80, 80))) for v in c)
        d.ellipse([x - r, y - r, x + r, y + r], fill=cc)
    # feine Struktur, damit Schärfe messbar ist
    for _ in range(400):
        x, y = rnd.randint(0, w) + dx, rnd.randint(0, h) + dy
        d.line([x, y, x + rnd.randint(-30, 30), y + rnd.randint(-30, 30)], fill=(255, 255, 255), width=2)
    return img


def save(img, name, t):
    exif = Image.Exif()
    exif[0x8769] = {0x9003: t.strftime('%Y:%m:%d %H:%M:%S'), 0x9291: f'{t.microsecond // 1000:03d}'}
    path = os.path.join(out, name)
    img.save(path, quality=85, exif=exif)
    ts = t.timestamp()
    os.utime(path, (ts, ts))


if len(sys.argv) > 2 and sys.argv[2] == '--simple':
    n = int(sys.argv[3])
    prefix = sys.argv[4]
    t = datetime.datetime(2023, 5, 1, 9, 0, 0)
    for i in range(1, n + 1):
        t += datetime.timedelta(hours=3)
        img = scene(100 + i, 1200, 800)
        ImageDraw.Draw(img).text((50, 40), f'{prefix}_{i:04d}', fill=(255, 255, 255), font=font)
        save(img, f'{prefix}_{i:04d}.JPG', t)
    print('ok')
    sys.exit(0)

base = datetime.datetime(2024, 7, 14, 10, 0, 0)
t = base
for i in range(1, 41):
    t += datetime.timedelta(seconds=0.4 if (i - 1) % 5 else 600)
    group = (i - 1) // 5
    w, h = (1600, 1067) if group % 3 else (1067, 1600)
    seed = 1000 + group
    if i == 9:
        seed = 5000  # anderes Motiv mitten in einer Serie
    img = scene(seed, w, h, dx=((i - 1) % 5) * 6, dy=((i - 1) % 5) * 3)
    ImageDraw.Draw(img).text((60, 50), f'IMG_{i:04d}', fill=(255, 255, 255), font=font)
    if (i - 1) % 5 == 1:
        img = img.filter(ImageFilter.GaussianBlur(7))  # verwackelt
    save(img, f'IMG_{i:04d}.JPG', t)

# Begleitdatei + Live Photo + Video
open(os.path.join(out, 'IMG_0003.xmp'), 'w').write('<x:xmpmeta/>')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '3',
                '-pix_fmt', 'yuv420p', '-c:v', 'libx264', os.path.join(out, 'IMG_0005.MOV')], check=False)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-t', '5',
                '-pix_fmt', 'yuv420p', '-c:v', 'libx264', os.path.join(out, 'Urlaubsvideo.mp4')], check=False)
print('ok')
