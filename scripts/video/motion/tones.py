"""Tonspur aus Ereignissen (für Videos ohne Stimme, z. B. Sortier-Rennen).

  python3 tones.py EREIGNISSE.json LÄNGE_S AUSGABE.wav
Ereignis [t, h, spur]: h 0..1 = kurzer Ton (Tonhöhe), -1 = Ziel-Akkord, -2 = Countdown-Piep, -3 = Start-Piep.
"""
import json, sys, wave
import numpy as np

SR = 48000
ev = json.load(open(sys.argv[1]))
L = float(sys.argv[2])
out = np.zeros(int(L * SR) + SR)


def tone(f, d, vol, shape='tri'):
    t = np.arange(int(d * SR)) / SR
    if shape == 'tri':
        w = 2 * np.abs(2 * ((t * f) % 1) - 1) - 1
    else:
        w = np.sin(2 * np.pi * f * t)
    env = np.minimum(1, t / 0.004) * np.exp(-t / (d * 0.35))
    return w * env * vol


PAN = [0.9, 0.95, 1.0, 1.05]  # Spuren leicht verschieden klingen lassen
for t, h, lane in ev:
    i = int(t * SR)
    if h >= 0:
        f = 180 * (2 ** (h * 2.6)) * PAN[lane % 4]
        s = tone(f, 0.07, 0.12)
    elif h == -1:   # Ziel: kleiner Dur-Akkord
        s = sum(tone(f, 0.6, 0.12, 'sin') for f in (660, 830, 990))
    elif h == -2:
        s = tone(880, 0.15, 0.3, 'sin')
    else:
        s = tone(1320, 0.35, 0.35, 'sin')
    out[i:i + len(s)] += s[: len(out) - i]
out = out[: int(L * SR)]
out = np.tanh(out * 1.2) * 0.8  # weich begrenzen, falls viele Töne zusammenfallen
w = wave.open(sys.argv[3], 'w')
w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((out * 32767).astype('<i2').tobytes())
w.close()
print('Töne:', len(ev), '→', sys.argv[3])
