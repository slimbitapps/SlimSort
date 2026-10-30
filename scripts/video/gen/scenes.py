"""Erzeugt bunte, gemalte „Fotos“ (Landschaften) per Code – gehören uns, keine Rechte Dritter.

  python3 scripts/video/gen/scenes.py AUSGABEORDNER [BREITE=1200]
Dateinamen: <thema>-<n>.jpg (beach, mountains, sunset, forest, city, desert, snow, flowers, aurora, lake)
"""
import math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
W = int(sys.argv[2]) if len(sys.argv) > 2 else 1200
H = W * 2 // 3
os.makedirs(OUT, exist_ok=True)


def grad(c1, c2, h=H, w=W):
    t = np.linspace(0, 1, h)[:, None, None]
    a = np.array(c1)[None, None, :] * (1 - t) + np.array(c2)[None, None, :] * t
    return np.repeat(a, w, axis=1)


def img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def ridge(d, rnd, y0, amp, col, rough=0.5, step=4):
    """Bergkette: Summe weicher Wellen (spitzere Gipfel durch |sin|) + etwas Rauheit"""
    ph = [rnd.random() * 6.3 for _ in range(4)]
    fr = [rnd.uniform(1.2, 2.2), rnd.uniform(3, 5), rnd.uniform(7, 11), rnd.uniform(18, 26)]
    pts = [(0, H)]
    for x in range(0, W + step, step):
        u = x / W * math.pi
        h = (1 - abs(math.sin(u * fr[0] + ph[0]))) * 1.0 + (1 - abs(math.sin(u * fr[1] + ph[1]))) * 0.45 \
            + math.sin(u * fr[2] + ph[2]) * 0.12 * rough + math.sin(u * fr[3] + ph[3]) * 0.05 * rough
        pts.append((x, y0 - h * amp * 2.2))
    pts.append((W, H))
    d.polygon(pts, fill=col)


def finish(im, seed):
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    a = np.asarray(im).astype(float)
    a += np.random.default_rng(seed).normal(0, 4, a.shape)  # Körnung wie ein Foto
    # Vignette
    yy, xx = np.mgrid[0:H, 0:W]
    v = 1 - 0.28 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    return img(a * v[..., None])


def beach(n):
    r = random.Random(n)
    hue = [(90, 170, 245), (255, 170, 120), (120, 200, 255)][n % 3]
    im = img(grad(hue, (235, 240, 250)))
    d = ImageDraw.Draw(im)
    sea = int(H * 0.52)
    d.rectangle([0, sea, W, H], fill=(20, 140, 190))
    for k in range(18):
        y = sea + k * 9 + r.randint(0, 5)
        d.line([(0, y), (W, y + r.randint(-6, 6))], fill=(60 + k * 4, 175 + k * 2, 210), width=3)
    d.polygon([(0, H * 0.72), (W * 0.4, H * 0.66), (W, H * 0.78), (W, H), (0, H)], fill=(238, 214, 165))
    d.polygon([(0, H * 0.72), (W * 0.4, H * 0.66), (W, H * 0.78), (W, H * 0.8), (W * 0.4, H * 0.69), (0, H * 0.75)], fill=(250, 250, 245))
    sx = r.randint(int(W * 0.15), int(W * 0.8))
    d.ellipse([sx - 50, H * 0.2 - 50, sx + 50, H * 0.2 + 50], fill=(255, 245, 200))
    px = r.choice([W * 0.12, W * 0.85])
    for k in range(7):  # Palme
        a = -math.pi / 2 + (k - 3) * 0.45
        d.line([(px, H * 0.42), (px + math.cos(a) * 140, H * 0.42 + math.sin(a) * 60 + 50)], fill=(30, 110, 60), width=18)
    d.line([(px, H * 0.42), (px + 30, H * 0.8)], fill=(110, 75, 45), width=16)
    return finish(im, n)


def mountains(n, sunset=False, snow=False):
    r = random.Random(n + 100)
    sky = [(255, 120, 90), (255, 200, 130)] if sunset else [(70, 130, 220), (200, 225, 250)]
    im = img(grad(*sky))
    d = ImageDraw.Draw(im)
    if sunset:
        d.ellipse([W * 0.55, H * 0.32, W * 0.75, H * 0.32 + W * 0.2], fill=(255, 235, 170))
    cols = [(120, 110, 170), (85, 80, 140), (55, 60, 105), (30, 45, 70)] if sunset else [(150, 170, 200), (100, 125, 160), (60, 95, 90), (40, 80, 50)]
    if snow:
        cols = [(225, 235, 250), (190, 205, 230), (150, 170, 205), (240, 245, 252)]
    for i, c in enumerate(cols):
        ridge(d, r, H * (0.45 + i * 0.12), 70 - i * 12, c, rough=1)
    if not snow and not sunset:
        d.rectangle([0, H * 0.82, W, H], fill=(70, 140, 200))
    return finish(im, n + 1)


def forest(n):
    r = random.Random(n + 200)
    im = img(grad((150, 200, 170), (230, 240, 210)))
    d = ImageDraw.Draw(im)
    for layer in range(4):
        g = 120 - layer * 25
        for k in range(26):
            x = r.uniform(-50, W + 50)
            base = H * (0.55 + layer * 0.13)
            h = r.uniform(120, 260) * (1 + layer * 0.3)
            d.polygon([(x, base - h), (x - h * 0.28, base), (x + h * 0.28, base)], fill=(20 + layer * 5, g, 60 - layer * 8))
    return finish(im, n + 2)


def city(n):
    r = random.Random(n + 300)
    im = img(grad((20, 25, 70), (230, 110, 120)))
    d = ImageDraw.Draw(im)
    x = 0
    while x < W:
        w = r.randint(50, 120); h = r.randint(150, 420)
        d.rectangle([x, H - h, x + w, H], fill=(25, 25, 45))
        for yy in range(H - h + 12, H, 22):
            for xx in range(x + 8, x + w - 8, 16):
                if r.random() < 0.45:
                    d.rectangle([xx, yy, xx + 7, yy + 10], fill=(255, 220, 130))
        x += w + r.randint(2, 10)
    return finish(im, n + 3)


def desert(n):
    r = random.Random(n + 400)
    im = img(grad((250, 170, 90), (255, 225, 170)))
    d = ImageDraw.Draw(im)
    d.ellipse([W * 0.7, H * 0.12, W * 0.82, H * 0.12 + W * 0.12], fill=(255, 250, 220))
    for i, c in enumerate([(225, 150, 90), (210, 125, 70), (190, 100, 55)]):
        ridge(d, r, H * (0.6 + i * 0.12), 22, c, rough=0.3)
    return finish(im, n + 4)


def flowers(n):
    r = random.Random(n + 500)
    im = img(grad((120, 180, 245), (230, 240, 255)))
    d = ImageDraw.Draw(im)
    ridge(d, r, H * 0.52, 10, (90, 160, 80), rough=0.3)
    cols = [(240, 70, 90), (255, 200, 60), (250, 250, 250), (200, 90, 220), (255, 140, 60)]
    for k in range(900):
        y = r.uniform(H * 0.52, H)
        s = 3 + (y - H * 0.5) / H * 22
        x = r.uniform(0, W)
        d.ellipse([x - s, y - s, x + s, y + s], fill=r.choice(cols))
    return finish(im, n + 5)


def aurora(n):
    r = random.Random(n + 600)
    im = img(grad((5, 10, 30), (20, 40, 70)))
    d = ImageDraw.Draw(im)
    for k in range(300):
        d.point((r.uniform(0, W), r.uniform(0, H * 0.6)), fill=(255, 255, 255))
    band = Image.new('RGB', (W, H), 0)
    bd = ImageDraw.Draw(band)
    for k in range(60):
        x = k * W / 60
        y = H * 0.3 + math.sin(k / 6 + n) * 60
        bd.line([(x, y - 120), (x + 10, y + 40)], fill=(40, 255, 160), width=26)
    band = band.filter(ImageFilter.GaussianBlur(28))
    im = Image.fromarray(np.clip(np.asarray(im).astype(int) + np.asarray(band).astype(int), 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    ridge(d, r, H * 0.8, 45, (10, 15, 25), rough=1)
    return finish(im, n + 6)


def lake(n):
    im = mountains(n + 50)
    a = np.asarray(im).astype(float).copy()
    cut = int(H * 0.66)
    refl = a[cut - (H - cut):cut][::-1]
    a[cut:] = refl * 0.7 + np.array([20, 60, 110]) * 0.3
    for y in range(cut, H, 7):
        a[y:y + 1] *= 1.06
    return finish(img(a), n + 7)


MAKERS = {'beach': beach, 'mountains': mountains, 'sunset': lambda n: mountains(n, sunset=True), 'forest': forest, 'city': city,
          'desert': desert, 'snow': lambda n: mountains(n, snow=True), 'flowers': flowers, 'aurora': aurora, 'lake': lake}
for name, fn in MAKERS.items():
    for n in range(1, 4):
        fn(n).convert('RGB').save(os.path.join(OUT, f'{name}-{n}.jpg'), quality=90)
print('fertig:', OUT, len(MAKERS) * 3, 'Bilder')
