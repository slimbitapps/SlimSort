"""Beispielfotos für den KI-Test (aus scikit-image, frei verwendbar): python sample_photos.py ordner"""
import os, sys
import numpy as np
import skimage.data as d
from PIL import Image

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for n in ['astronaut', 'cat', 'chelsea', 'coffee', 'rocket', 'grass', 'gravel', 'brick', 'hubble_deep_field', 'moon', 'page', 'text', 'camera', 'clock', 'coins', 'stereo_motorcycle']:
    a = getattr(d, n)()
    if isinstance(a, tuple):
        a = a[0]
    a = np.asarray(a)
    if a.dtype != np.uint8:
        a = (255 * (a - a.min()) / (a.max() - a.min() + 1e-9)).astype(np.uint8)
    if a.ndim == 2:
        a = np.stack([a] * 3, -1)
    Image.fromarray(a[..., :3]).save(os.path.join(out, f'{n}.jpg'), quality=92)
print(len(os.listdir(out)), 'Fotos')
