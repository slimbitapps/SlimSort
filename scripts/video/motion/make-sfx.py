"""Erzeugt kurze Soundeffekte (selbst berechnet, daher frei nutzbar): Tastenklick, Wusch, Pop."""
import os, wave
import numpy as np

SR = 48000
OUT = os.path.join(os.path.dirname(__file__), 'sfx')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(3)


def save(name, x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def t(d):
    return np.arange(int(SR * d)) / SR


# Mechanischer Tastenklick: zwei kurze Anschläge (Taste runter + Anschlag), etwas Rauschen
tt = t(0.09)
hit = lambda f, dec, amp: amp * np.exp(-tt * dec) * np.sin(2 * np.pi * f * tt)
click = hit(2400, 90, 0.6) + hit(5200, 140, 0.35) + 0.5 * np.exp(-tt * 120) * rng.uniform(-1, 1, tt.size)
click2 = np.zeros_like(click); s = int(0.028 * SR)
click2[s:] = (0.45 * np.exp(-tt * 160) * np.sin(2 * np.pi * 1700 * tt))[: tt.size - s]
save('click', click + click2)

# Wusch: gefiltertes Rauschen, das an- und abschwillt, Tonhöhe steigt
tt = t(0.42)
noise = rng.normal(0, 1, tt.size)
env = np.sin(np.pi * tt / tt[-1]) ** 2
# einfacher Tiefpass mit wandernder Grenzfrequenz
out = np.zeros_like(noise); y = 0.0
for i, n in enumerate(noise):
    fc = 600 + 3500 * (i / noise.size)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y += a * (n - y)
    out[i] = y
save('whoosh', out * env)

# Pop beim Landen im Ordner: kurzer Ton, der nach oben gleitet
tt = t(0.16)
f = 500 + 900 * tt / tt[-1]
pop = np.exp(-tt * 28) * np.sin(2 * np.pi * np.cumsum(f) / SR)
save('pop', pop)

# Rückwärts-Wusch (Rückgängig)
save('whoosh-back', (out * env)[::-1])
print('ok', os.listdir(OUT))
