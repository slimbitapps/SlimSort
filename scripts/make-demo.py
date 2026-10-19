"""Erzeugt ansprechende Beispielfotos (Landschaften) für Screenshots und Videos.

  python3 make-demo.py ZIEL [--singles | --series]

Ca. 60 Bilder mit EXIF-Aufnahmezeit, darunter Serien (5 Bilder in 0,5 s, eins verwackelt).
"""
import os, sys, random, math, datetime
from PIL import Image, ImageDraw, ImageFilter, ImageChops

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
W, H = 1800, 1200


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky(d, top, bottom, h):
    for y in range(H):  # ganze Höhe füllen (keine Lücken unter Hügeln)
        d.line([(0, y), (W, y)], fill=lerp(top, bottom, min(1, y / h)))


def ridge(d, rnd, base, amp, color, rough=6, dx=0):
    pts = [(0, H)]
    phase = [rnd.uniform(0, 6) for _ in range(rough)]
    for x in range(0, W + 20, 20):
        y = base
        for k in range(rough):
            y += math.sin((x + dx) / (W / (k + 1.3)) + phase[k]) * amp / (k + 1)
        pts.append((x, y))
    pts.append((W, H))
    d.polygon(pts, fill=color)
    return pts


def peaks(d, rnd, base, amp, color, dx=0):
    """Zackige Bergkette: zufällige Gipfel, dazwischen kleine Unebenheiten."""
    pts = [(-300, H), (-300, base - amp * 0.5)]
    x = -300
    y = base
    while x < W + 100:
        x += rnd.randint(60, 220)
        top = rnd.random() < 0.45
        y = base - (rnd.uniform(0.6, 1.0) * amp if top else rnd.uniform(0, 0.35) * amp)
        pts.append((x + dx, y))
    pts.append((W + 300, H))
    d.polygon(pts, fill=color)
    return pts


def sun(img, x, y, r, color, glow=3.0):
    g = Image.new('L', img.size, 0)
    ImageDraw.Draw(g).ellipse([x - r * glow, y - r * glow, x + r * glow, y + r * glow], fill=110)
    g = g.filter(ImageFilter.GaussianBlur(r * 1.2))
    img.paste(Image.new('RGB', img.size, color), (0, 0), g)
    ImageDraw.Draw(img).ellipse([x - r, y - r, x + r, y + r], fill=color)


def tree(d, x, y, s, color):
    for i in range(3):
        w = s * (1 - i * 0.22)
        d.polygon([(x - w, y - i * s * 0.55), (x + w, y - i * s * 0.55), (x, y - i * s * 0.55 - s * 1.1)], fill=color)
    d.rectangle([x - s * 0.12, y, x + s * 0.12, y + s * 0.4], fill=(60, 40, 30))


def beach(rnd, dx):
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    sky(d, (70, 140, 230), (190, 225, 250), 640)
    sun(img, 1300 + dx, 230, 70, (255, 244, 210))
    d = ImageDraw.Draw(img)
    for i in range(5):  # Wolken
        cx, cy = rnd.randint(0, W), rnd.randint(80, 380)
        for _ in range(6):
            r = rnd.randint(40, 90)
            ox, oy = rnd.randint(-120, 120), rnd.randint(-25, 25)
            d.ellipse([cx + ox - r + dx, cy + oy - r * 0.6, cx + ox + r + dx, cy + oy + r * 0.6], fill=(250, 252, 255))
    for y in range(640, 900):
        d.line([(0, y), (W, y)], fill=lerp((30, 120, 180), (60, 190, 200), (y - 640) / 260))
    for _ in range(140):
        x, y = rnd.randint(0, W), rnd.randint(650, 890)
        d.line([(x, y), (x + rnd.randint(20, 70), y)], fill=(200, 235, 245), width=2)
    pts = ridge(d, rnd, 900, 25, (235, 214, 170), 3, dx)
    for y in range(880, H):
        d.line([(0, y), (W, y)], fill=lerp((236, 215, 172), (214, 186, 140), (y - 880) / (H - 880)))
    ImageDraw.Draw(img).polygon(pts[:1] + [(p[0], p[1] - 6) for p in pts[1:-1]] + pts[-1:], outline=(255, 255, 255))
    return img


def mountains(rnd, dx):
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    warm = rnd.random() < 0.5
    sky(d, (40, 80, 160) if not warm else (90, 70, 150), (240, 200, 170) if warm else (180, 210, 240), H)
    if warm:
        sun(img, 600 + dx, 520, 60, (255, 210, 150))
        d = ImageDraw.Draw(img)
    cols = [(120, 130, 170), (85, 95, 140), (55, 70, 110), (35, 50, 80)] if not warm else [(150, 110, 150), (110, 80, 125), (75, 55, 95), (45, 35, 65)]
    for i, c in enumerate(cols):
        pts = peaks(d, rnd, 560 + i * 150, 330 - i * 60, c, dx * (i + 1) * 0.4)
        if i == 0:  # Schnee auf den hohen Gipfeln
            for k in range(1, len(pts) - 2):
                (x0, y0), (x1, y1), (x2, y2) = pts[k - 1], pts[k], pts[k + 1]
                if y1 < 330 and y1 < y0 and y1 < y2:
                    f = 0.28
                    d.polygon([(x1, y1), (x1 + (x2 - x1) * f, y1 + (y2 - y1) * f), (x1 + (x0 - x1) * f, y1 + (y0 - y1) * f)], fill=(245, 246, 250))
    return img


def forest(rnd, dx):
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    sky(d, (150, 200, 220), (230, 240, 225), 700)
    for i, c in enumerate([(120, 160, 140), (70, 120, 90), (40, 85, 60)]):
        ridge(d, rnd, 560 + i * 140, 60, c, 4, dx)
        for _ in range(40 - i * 8):
            x = rnd.randint(-40, W + 40) + dx * (i + 1) * 0.5
            tree(d, x, 640 + i * 150 + rnd.randint(0, 60), 40 + i * 30, lerp(c, (10, 40, 25), 0.3))
    d.rectangle([0, 1080, W, H], fill=(55, 90, 50))
    return img


def city(rnd, dx):
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    sky(d, (30, 30, 80), (250, 140, 90), 900)
    sun(img, 900 + dx, 820, 90, (255, 190, 120))
    d = ImageDraw.Draw(img)
    x = -50
    while x < W:
        w = rnd.randint(70, 170)
        h = rnd.randint(250, 700)
        top = 1000 - h
        d.rectangle([x + dx, top, x + w + dx, H], fill=(28, 26, 48))
        for wy in range(top + 20, 990, 34):
            for wx in range(x + 12, x + w - 12, 26):
                if rnd.random() < 0.35:
                    d.rectangle([wx + dx, wy, wx + 12 + dx, wy + 16], fill=(255, 215, 130))
        x += w + rnd.randint(4, 20)
    for y in range(1000, H):
        d.line([(0, y), (W, y)], fill=lerp((60, 40, 70), (20, 20, 35), (y - 1000) / 200))
    return img


def flowers(rnd, dx):
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    sky(d, (90, 160, 235), (210, 235, 250), 560)
    ridge(d, rnd, 520, 40, (110, 170, 90), 3, dx)
    for y in range(600, H):
        d.line([(0, y), (W, y)], fill=lerp((100, 170, 80), (50, 120, 45), (y - 600) / (H - 600)))
    pal = [(240, 80, 90), (250, 200, 60), (250, 250, 250), (200, 90, 200), (250, 140, 40)]
    for _ in range(900):
        y = rnd.randint(600, H)
        s = 3 + (y - 600) / 600 * 16
        x = rnd.randint(0, W) + dx * (y / H)
        c = rnd.choice(pal)
        d.ellipse([x - s, y - s, x + s, y + s], fill=c)
        d.ellipse([x - s * 0.35, y - s * 0.35, x + s * 0.35, y + s * 0.35], fill=(250, 220, 90))
    return img


def finish(img, rnd, blur=0):
    img = img.filter(ImageFilter.GaussianBlur(1.1 + blur))
    noise = Image.effect_noise(img.size, 14).convert('RGB')
    img = ImageChops.blend(img, ImageChops.overlay(img, noise), 0.18)
    # Vignette
    v = Image.new('L', img.size, 0)
    ImageDraw.Draw(v).ellipse([-W * 0.2, -H * 0.25, W * 1.2, H * 1.25], fill=255)
    v = v.filter(ImageFilter.GaussianBlur(220))
    return Image.composite(img, Image.new('RGB', img.size, (0, 0, 0)), v.point(lambda p: 150 + p * 105 // 255))


def save(img, name, t):
    exif = Image.Exif()
    exif[0x8769] = {0x9003: t.strftime('%Y:%m:%d %H:%M:%S'), 0x9291: f'{t.microsecond // 1000:03d}'}
    exif[0x010F] = 'Demo'
    p = os.path.join(out, name)
    img.save(p, quality=86, exif=exif)
    os.utime(p, (t.timestamp(), t.timestamp()))


SCENES = [beach, mountains, forest, city, flowers]
rnd0 = random.Random(7)
t = datetime.datetime(2025, 8, 3, 9, 12, 0)
n = 0
plan = []  # (Szene, Seed, Serie?)
mode = sys.argv[2] if len(sys.argv) > 2 else ''
if mode == '--singles':  # nur Einzelfotos (für Sortier-Videos)
    for k in range(40):
        plan.append((SCENES[(k * 3) % 5], 300 + k, False))
elif mode == '--series':  # Serie gleich am Anfang (für Vergleichs-Videos)
    plan.append((SCENES[1], 100 + 1, True))
    for k in range(6):
        plan.append((SCENES[k % 5], 200 + k, False))
else:
    for k in range(24):
        plan.append((SCENES[k % 5], 100 + k, k % 4 == 1))
for scene, seed, series in plan:
    shots = 5 if series else 1
    t += datetime.timedelta(minutes=rnd0.randint(7, 55))
    for s in range(shots):
        n += 1
        rnd = random.Random(seed)
        img = scene(rnd, s * 9)
        img = finish(img, random.Random(seed * 10 + s), blur=5 if (series and s == 1) else 0)
        save(img, f'IMG_{4000 + n:04d}.JPG', t + datetime.timedelta(seconds=s * 0.5))
print(n, 'Fotos')
