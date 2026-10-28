"""Testfotos für den Personen-Test: drei Personen in zwei Reihenfolgen + ein Einzelfoto.

  python face_photos.py ordner

Personen: Astronautin (scikit-image) und zwei Beispielbilder aus OpenCV. Nur für Tests,
die Bilder werden nicht ins Projekt übernommen.
  g1.jpg = A, B, C (von links)   g2.jpg = C, A, B   solo.jpg = B
"""
import io, os, sys, urllib.request
import numpy as np
import skimage.data as d
from PIL import Image

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
URL = 'https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/'


def get(name):
    for i in range(4):
        try:
            return Image.open(io.BytesIO(urllib.request.urlopen(URL + name, timeout=60).read())).convert('RGB')
        except Exception:
            if i == 3:
                raise


A = Image.fromarray(np.asarray(d.astronaut())[..., :3])
B = get('messi5.jpg')
C = get('lena.jpg')


def fit(im, h):
    return im.resize((int(im.width * h / im.height), h))


def comp(order, name):
    ims = [fit(x, 520) for x in order]
    c = Image.new('RGB', (sum(i.width for i in ims) + 20 * (len(ims) + 1), 560), (200, 205, 210))
    x = 20
    for i in ims:
        c.paste(i, (x, 20))
        x += i.width + 20
    c.save(os.path.join(out, name), quality=90)


comp([A, B, C], 'g1.jpg')
comp([C, A, B], 'g2.jpg')
comp([B], 'solo.jpg')
print('Testfotos für Personen:', sorted(os.listdir(out)))
