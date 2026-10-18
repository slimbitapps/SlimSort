"""Erzeugt Testfotos (mit EXIF-Aufnahmezeit) und ein Testvideo."""
import os, sys, random, subprocess, datetime
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
random.seed(4)
base = datetime.datetime(2024, 7, 14, 10, 0, 0)
palette = [(91,140,255),(47,191,113),(245,165,36),(239,79,95),(166,108,255),(24,184,201),(255,122,182)]
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 90)
except Exception:
    font = ImageFont.load_default()
t = base
for i in range(1, 41):
    # Serien: manche Fotos nur 0,4 s auseinander, sonst Minuten
    t += datetime.timedelta(seconds=0.4 if i % 5 else 600)
    w, h = (1600, 1067) if i % 7 else (1067, 1600)
    c = palette[i % len(palette)]
    img = Image.new('RGB', (w, h), c)
    d = ImageDraw.Draw(img)
    for _ in range(14):
        x, y = random.randint(0, w), random.randint(0, h)
        r = random.randint(40, 260)
        cc = tuple(min(255, max(0, v + random.randint(-70, 70))) for v in c)
        d.ellipse([x - r, y - r, x + r, y + r], fill=cc)
    d.text((60, 50), f'IMG_{i:04d}', fill=(255, 255, 255), font=font)
    exif = Image.Exif()
    exif[0x8769] = {0x9003: t.strftime('%Y:%m:%d %H:%M:%S'), 0x9291: f'{t.microsecond // 1000:03d}'}
    name = os.path.join(out, f'IMG_{i:04d}.JPG')
    img.save(name, quality=85, exif=exif)
    ts = t.timestamp()
    os.utime(name, (ts, ts))
# Begleitdatei + Live Photo
open(os.path.join(out, 'IMG_0003.xmp'), 'w').write('<x:xmpmeta/>')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '3',
                '-pix_fmt', 'yuv420p', '-c:v', 'libx264', os.path.join(out, 'IMG_0005.MOV')], check=False)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-t', '5',
                '-pix_fmt', 'yuv420p', '-c:v', 'libx264', os.path.join(out, 'Urlaubsvideo.mp4')], check=False)
print('ok')
