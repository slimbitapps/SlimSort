"""
Gesichtsmodelle für SlimSort (läuft auf GitHub Actions):
  - YuNet (Gesichter finden, MIT-Lizenz, OpenCV Zoo)
  - SFace (Gesichter wiedererkennen, Apache-2.0, OpenCV Zoo)
Dazu Vergleichswerte mit OpenCV für den Test der eigenen Umsetzung im Helfer-Programm.

  python faces.py out
"""
import json, os, sys, urllib.request
import numpy as np
import cv2
import skimage.data as d

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)

FILES = {
    'slimsort-face-detect.onnx': ['https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
                                  'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx'],
    'slimsort-face-embed.onnx': ['https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx',
                                 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx'],
}
for name, urls in FILES.items():
    dst = os.path.join(OUT, name)
    for u in urls:
        try:
            urllib.request.urlretrieve(u, dst)
            if os.path.getsize(dst) > 100_000:
                print('geladen', name, u, os.path.getsize(dst))
                break
        except Exception as e:
            print('fehlgeschlagen', u, e)
    assert os.path.getsize(dst) > 100_000, name

det_p = os.path.join(OUT, 'slimsort-face-detect.onnx')
rec_p = os.path.join(OUT, 'slimsort-face-embed.onnx')

# Testbilder: Astronautin (1 Gesicht) und ein Bild mit 2 Gesichtern (nebeneinander, eins verkleinert)
a = d.astronaut()[:, :, ::-1].copy()  # BGR
small = cv2.resize(a, (256, 256))
two = np.full((512, 800, 3), 200, np.uint8)
two[:, :512] = a
two[128:384, 540:796] = small
imgs = {'astronaut.png': a, 'zwei.png': two}
ref = {}
rec = cv2.FaceRecognizerSF.create(rec_p, '')
for n, im in imgs.items():
    cv2.imwrite(os.path.join(OUT, f'slimsort-face-test-{n}'), im)
    h, w = im.shape[:2]
    det = cv2.FaceDetectorYN.create(det_p, '', (w, h), 0.6, 0.3, 5000)
    _, faces = det.detect(im)
    faces = [] if faces is None else faces
    out = []
    for f in faces:
        crop = rec.alignCrop(im, f)
        feat = rec.feature(crop)[0]
        out.append({'box': [float(x) for x in f[:4]], 'kps': [float(x) for x in f[4:14]], 'score': float(f[14]),
                    'emb': [float(x) for x in feat]})
    ref[n] = out
    print(n, len(out), 'Gesichter', [o['score'] for o in out])
if len(ref['zwei.png']) == 2:
    e = [np.array(o['emb']) for o in ref['zwei.png']]
    c = float(e[0] @ e[1] / np.linalg.norm(e[0]) / np.linalg.norm(e[1]))
    print('gleiche Person (groß/klein) cos =', c)
json.dump(ref, open(os.path.join(OUT, 'slimsort-face-ref.json'), 'w'))
# Aufbau der Modelle (Ein-/Ausgänge) für die eigene Umsetzung
import onnx
for p in (det_p, rec_p):
    m = onnx.load(p)
    print(os.path.basename(p), 'Eingänge', [(i.name, [x.dim_value or x.dim_param for x in i.type.tensor_type.shape.dim]) for i in m.graph.input])
    print(os.path.basename(p), 'Ausgänge', [(o.name, [x.dim_value or x.dim_param for x in o.type.tensor_type.shape.dim]) for o in m.graph.output])
    print(os.path.basename(p), 'Operatoren', sorted(set(n.op_type for n in m.graph.node)))
