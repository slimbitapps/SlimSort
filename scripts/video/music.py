"""Eigene Hintergrundmusik per Code – gehört uns, also keine Urheberrechts- oder Content-ID-Probleme.

  python3 scripts/video/music.py STIL SEKUNDEN AUSGABE.wav [--seed N]
  STIL: lofi (ruhig, warm) · pop (fröhlich, Energie) · epic (groß, filmisch) · house (entspannt, tanzbar) · happy (Ukulele, Pfeifen)

Nur numpy. Jede Zahl bei --seed ergibt eine andere Melodie/Variante im selben Stil (Standard: 1).
Am Ende wird die Musik weich ausgeblendet. In finish.sh wird sie automatisch unter die Stimme gelegt
und leiser, sobald gesprochen wird.
"""
import argparse, wave
import numpy as np

SR = 48000
rng = np.random.default_rng(1)


def hz(m):  # MIDI-Note → Hz
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(sec):
    return np.arange(int(sec * SR)) / SR


def filt(x, lo=None, hi=None, order=2):  # Hoch-/Tiefpass im Frequenzbereich (ganze Spur auf einmal)
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(x.shape[0], 1 / SR)[:, None] if x.ndim > 1 else np.fft.rfftfreq(x.shape[0], 1 / SR)
    H = np.ones_like(f)
    if hi: H = H / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo: H = H / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * H, n=x.shape[0], axis=0)


def reverb(x, rt=2.0, mix=0.25, hi=6000):
    n = int(rt * SR)
    ir = rng.standard_normal((n, 2)) * np.exp(-6.9 * np.arange(n) / n)[:, None]
    ir = filt(ir, hi=hi)
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    N = 1 << int(np.ceil(np.log2(len(x) + n)))
    w = np.fft.irfft(np.fft.rfft(x, N, axis=0) * np.fft.rfft(ir, N, axis=0), N, axis=0)[: len(x)]
    return x + mix * w


def saw(f, t, ph=0.0):
    return 2 * ((f * t + ph) % 1.0) - 1


def additive(f, dur, nh=12, tilt=1.0, dec=3.0, deck=0.6, inharm=0.0):
    """Gezupft/Klavier-artig: höhere Obertöne klingen schneller ab (wie ein Filter, der zugeht)."""
    t = tt(dur); y = np.zeros_like(t)
    for k in range(1, nh + 1):
        fk = f * k * (1 + inharm * k * k)
        if fk > 16000: break
        y += np.sin(2 * np.pi * fk * t + k) / k ** tilt * np.exp(-t * (dec + deck * k))
    return y * np.minimum(1, t / 0.004)


def adsr(n, a, d, s, r, sus_len):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t > sus_len
    return np.where(rel, e * np.exp(-(t - sus_len) / max(r, 1e-4)), e)


def pad(notes, dur, voices=5, det=0.12, a=0.6, r=1.2, hi=2500):
    t = tt(dur + r * 2); y = np.zeros((len(t), 2))
    for m in notes:
        for v in range(voices):
            cents = (v - (voices - 1) / 2) * det / (voices - 1) * 100 * 2
            s = saw(hz(m) * 2 ** (cents / 1200), t, rng.random())
            pan = (v / (voices - 1)) if voices > 1 else 0.5
            y[:, 0] += s * (1 - pan); y[:, 1] += s * pan
    y = filt(y, hi=hi, order=2)
    return y * adsr(len(t), a, 1.0, 0.85, r, dur)[:, None] / (len(notes) * voices) * 2


def kick(punch=1.0, dec=0.38):
    t = tt(0.6)
    f = 45 + 110 * np.exp(-t * 28) * punch
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec * 3)
    return np.tanh(2 * y) * 0.9 + rng.standard_normal(len(t)) * np.exp(-t * 400) * 0.15


def snare(tone=190, dec=0.16, bright=6000):
    t = tt(0.5)
    n = filt(rng.standard_normal(len(t)), lo=1200, hi=bright) * np.exp(-t / dec * 3)
    return 0.7 * n / np.abs(n).max() + 0.4 * np.sin(2 * np.pi * tone * t) * np.exp(-t * 30)


def clap():
    t = tt(0.4); e = np.zeros_like(t)
    for d in (0, 0.011, 0.022):
        e += (t >= d) * np.exp(-np.maximum(t - d, 0) * (60 if d < 0.02 else 12))
    n = filt(rng.standard_normal(len(t)), lo=1000, hi=7000)
    return n / np.abs(n).max() * e * 0.7


def hat(open_=False):
    t = tt(0.3 if open_ else 0.08)
    n = filt(rng.standard_normal(len(t)), lo=7000)
    return n / np.abs(n).max() * np.exp(-t * (14 if open_ else 70)) * 0.5


def tom(f0=90, dec=0.6):
    t = tt(1.2)
    f = f0 * (1 + 0.6 * np.exp(-t * 12))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec * 3)
    n = filt(rng.standard_normal(len(t)), hi=900) * np.exp(-t * 18) * 0.4
    return np.tanh(1.5 * (y + n))


class Mix:
    def __init__(self, sec):
        self.n = int(sec * SR); self.bus = {}

    def add(self, name, sig, at, gain=1.0, pan=0.5):
        b = self.bus.setdefault(name, np.zeros((self.n + SR * 4, 2)))
        i = int(at * SR)
        if i >= self.n: return
        s = sig if sig.ndim == 2 else np.stack([sig * np.cos(pan * np.pi / 2), sig * np.sin(pan * np.pi / 2)], 1) * np.sqrt(2)
        # jede Note am Ende kurz ausblenden – sonst knackt es, wenn sie noch klingt und abgeschnitten wird
        fo = min(len(s) // 4, int(0.012 * SR))
        if fo > 1:
            s = s.copy(); s[-fo:] *= np.linspace(1, 0, fo)[:, None]
        s = s[: len(b) - i]
        b[i:i + len(s)] += s * gain


# ---------- Stile ----------
def lofi(sec, seed):
    bpm = 78; beat = 60 / bpm; bar = beat * 4
    # Dm9 – G13 – Cmaj9 – Am9 (warm, jazzig)
    prog = [[50, 57, 60, 64, 65], [43, 59, 62, 64, 65], [48, 55, 59, 62, 64], [45, 55, 59, 60, 64]]
    bass = [38, 43, 36, 45]
    scale = [62, 64, 65, 67, 69, 72, 74, 76]
    m = Mix(sec); r = np.random.default_rng(seed); bars = int(np.ceil(sec / bar)) + 1
    K, S, H = kick(0.7, 0.3), snare(170, 0.2, 4500), hat()
    for b in range(bars):
        t0 = b * bar; ch = prog[b % 4]
        for i, n in enumerate(ch):  # Rhodes-artige Akkorde, leicht verschleppt
            m.add('keys', additive(hz(n), bar * 1.3, nh=6, tilt=1.6, dec=0.55, deck=0.4) * (1 + 0.15 * np.sin(2 * np.pi * 4.5 * tt(bar * 1.3))), t0 + i * 0.012, 0.16, 0.35 + 0.08 * i)
        m.add('bass', np.tanh(1.5 * np.sin(2 * np.pi * hz(bass[b % 4]) * tt(bar * 1.02))) * adsr(int(bar * 1.02 * SR), 0.01, 0.8, 0.7, 0.04, bar * 0.97), t0, 0.32)
        if b == 0: continue  # erster Takt nur Akkorde
        for q in range(4):
            sw = beat / 2 * 0.58  # Swing
            if q in (0, 2) or (q == 3 and r.random() < 0.4): m.add('drums', K, t0 + q * beat + (0.5 * beat if q == 3 else 0), 0.75)
            if q in (1, 3): m.add('drums', S, t0 + q * beat + 0.015, 0.4)
            m.add('drums', H, t0 + q * beat, 0.22 * (0.8 + 0.4 * r.random()), 0.6)
            m.add('drums', H, t0 + q * beat + sw * 2 * 0.86, 0.14, 0.6)
        if b % 2 == 1 or r.random() < 0.5:  # sparsame Melodie (Glockenspiel-artig)
            for k in range(r.integers(2, 5)):
                n = scale[r.integers(len(scale))] + 12
                m.add('lead', additive(hz(n), 1.2, nh=4, tilt=2, dec=2.5, deck=1.2), t0 + r.integers(0, 8) * beat / 2, 0.09, 0.3 + 0.4 * r.random())
    fx = {'keys': dict(hi=3200), 'lead': dict(hi=6000), 'drums': dict(hi=7000), 'bass': dict(hi=900)}
    return m, fx, dict(rt=1.8, mix=0.22)


def pop(sec, seed):
    bpm = 116; beat = 60 / bpm; bar = beat * 4
    # Am – F – C – G (vi–IV–I–V), hell und positiv
    prog = [[57, 60, 64, 69], [53, 57, 60, 65], [52, 55, 60, 64], [55, 59, 62, 67]]
    bass = [33, 29, 36, 31]
    m = Mix(sec); r = np.random.default_rng(seed); bars = int(np.ceil(sec / bar)) + 1
    K, C, H, HO = kick(1.0, 0.35), clap(), hat(), hat(True)
    pat = [0, 2, 1, 2, 0, 3, 1, 2] if seed % 2 else [0, 1, 2, 3, 2, 1, 2, 3]
    for b in range(bars):
        t0 = b * bar; ch = prog[b % 4]
        m.add('pad', pad([n + 12 for n in ch[1:]], bar, voices=5, det=0.18, a=0.05, r=0.3, hi=4000), t0, 0.5)
        for e in range(16):  # gezupftes 16tel-Arpeggio
            n = ch[pat[e % 8] % 4] + 12 + (12 if e % 8 == 7 else 0)
            m.add('pluck', additive(hz(n), 0.35, nh=14, tilt=1.0, dec=7, deck=1.4), t0 + e * beat / 4, 0.12 * (1.0 if e % 4 == 0 else 0.7), 0.25 + 0.5 * ((e % 4) / 3))
        for q in range(8):
            f = hz(bass[b % 4] + (12 if q % 2 else 0))
            m.add('bass', np.tanh(2 * saw(f, tt(beat / 2 * 0.9))) * adsr(int(beat / 2 * 0.9 * SR), 0.003, 0.15, 0.5, 0.03, beat / 2 * 0.8), t0 + q * beat / 2, 0.22)
        if b == 0: continue
        for q in range(4):
            m.add('drums', K, t0 + q * beat, 0.8)
            if q in (1, 3): m.add('drums', C, t0 + q * beat, 0.5)
            m.add('drums', HO if q == 3 and b % 2 else H, t0 + q * beat + beat / 2, 0.25, 0.65)
            m.add('drums', H, t0 + q * beat + beat / 4 * 3, 0.1, 0.4)
    # Pumpen (Sidechain auf die Kick) für Pad, Bass, Pluck
    t = np.arange(m.n + SR * 4) / SR
    ph = (t % beat) / beat
    pump = np.where(t < bar, 1.0, 0.35 + 0.65 * np.minimum(1, ph / 0.45) ** 1.5)
    for k in ('pad', 'bass', 'pluck'):
        if k in m.bus: m.bus[k] *= pump[:, None]
    fx = {'pad': dict(hi=5000, lo=200), 'pluck': dict(hi=9000, lo=250), 'bass': dict(hi=1500), 'drums': dict(hi=12000)}
    return m, fx, dict(rt=1.5, mix=0.2)


def epic(sec, seed):
    bpm = 92; beat = 60 / bpm; bar = beat * 4
    # Dm – Bb – F – C (i–VI–III–VII), filmisch
    prog = [[50, 57, 62, 65], [46, 53, 58, 62], [45, 53, 57, 60], [48, 55, 60, 64]]
    low = [38, 34, 41, 36]
    m = Mix(sec); r = np.random.default_rng(seed); bars = int(np.ceil(sec / bar)) + 1
    T1, T2, S, K = tom(70, 0.9), tom(110, 0.5), snare(200, 0.25, 8000), kick(1.2, 0.5)
    for b in range(bars):
        t0 = b * bar; ch = prog[b % 4]
        m.add('strings', pad(ch, bar, voices=7, det=0.1, a=0.35, r=1.0, hi=2200), t0, 0.9)
        m.add('strings', pad([ch[2] + 12, ch[3] + 12], bar, voices=5, det=0.08, a=0.5, r=1.0, hi=3500), t0, 0.35 * min(1, b / 2))
        for e in range(8):  # treibendes Ostinato tiefer Streicher
            n = low[b % 4] + (0 if e % 2 == 0 else 12)
            s = saw(hz(n), tt(beat / 2)) * adsr(int(beat / 2 * SR), 0.01, 0.12, 0.4, 0.05, beat / 2 * 0.7)
            m.add('ost', s, t0 + e * beat / 2, 0.22)
        if b == 0: continue
        for q in range(4):  # große Trommeln
            if q in (0, 2): m.add('drums', T1, t0 + q * beat, 0.9); m.add('drums', K, t0 + q * beat, 0.5)
            if q == 2 or (q == 3 and b % 2): m.add('drums', T2, t0 + q * beat + (beat / 2 if q == 3 else 0), 0.5, 0.4)
            if q in (1, 3): m.add('drums', S, t0 + q * beat, 0.35)
        if b % 4 == 3:  # kleiner Wirbel vor dem nächsten Durchgang
            for k in range(4): m.add('drums', T2, t0 + 3 * beat + k * beat / 4, 0.3 + 0.1 * k, 0.6)
        if b >= 2 and b % 2 == 0:  # Blech-Melodie
            mel = [ch[2] + 12, ch[3] + 12, ch[1] + 12][r.integers(0, 3)]
            s = sum(saw(hz(mel) * d, tt(bar * 0.95)) for d in (1, 1.004)) * adsr(int(bar * 0.95 * SR), 0.25, 1.0, 0.8, 0.4, bar * 0.7)
            m.add('brass', s, t0, 0.12, 0.55)
    fx = {'strings': dict(hi=4000, lo=60), 'ost': dict(hi=1800), 'brass': dict(hi=2600, lo=200), 'drums': dict(hi=9000)}
    return m, fx, dict(rt=2.8, mix=0.3)


def house(sec, seed):
    """Entspannter Deep-House: gerade Kick, warme Akkord-Stabs, federnder Bass, Shaker."""
    bpm = 120; beat = 60 / bpm; bar = beat * 4
    # Fmaj7 – Em7 – Dm7 – Cmaj7 (sanft absteigend)
    prog = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]
    bass = [29, 28, 26, 24]
    m = Mix(sec); r = np.random.default_rng(seed); bars = int(np.ceil(sec / bar)) + 1
    K, C, H, HO = kick(0.9, 0.3), clap(), hat(), hat(True)
    stab_at = [0.5, 1.5, 2.75, 3.5] if seed % 2 else [0.5, 1.25, 2.5, 3.5]
    for b in range(bars):
        t0 = b * bar; ch = prog[b % 4]
        for q in stab_at:  # kurze, weiche Akkord-Stabs (Orgel/Piano-artig)
            for i, n in enumerate(ch):
                m.add('stab', additive(hz(n + 12), 0.45, nh=8, tilt=1.4, dec=5, deck=0.8), t0 + q * beat + i * 0.004, 0.11, 0.3 + 0.13 * i)
        m.add('pad', pad([n + 12 for n in ch], bar, voices=4, det=0.1, a=0.4, r=0.8, hi=1800), t0, 0.28)
        for q in range(4):  # Bass auf den Offbeats + Oktavsprung
            f = hz(bass[b % 4] + 12 + (12 if q == 3 and b % 2 else 0))
            s = np.sin(2 * np.pi * f * tt(beat * 0.45)) + 0.3 * np.sin(4 * np.pi * f * tt(beat * 0.45))
            m.add('bass', s * adsr(int(beat * 0.45 * SR), 0.004, 0.2, 0.6, 0.04, beat * 0.38), t0 + q * beat + beat / 2, 0.34)
        if b == 0: continue
        for q in range(4):
            m.add('drums', K, t0 + q * beat, 0.7)
            if q in (1, 3): m.add('drums', C, t0 + q * beat, 0.35, 0.55)
            m.add('drums', HO if q % 2 else H, t0 + q * beat + beat / 2, 0.16, 0.62)
            for k in range(4):  # Shaker in 16teln
                m.add('drums', H, t0 + q * beat + k * beat / 4, 0.05 + 0.03 * (k == 2), 0.35)
        if b >= 2 and r.random() < 0.7:  # kleine Melodie (Marimba-artig)
            sc = [65, 67, 69, 72, 74, 76]
            for k in range(3):
                m.add('lead', additive(hz(sc[r.integers(len(sc))]), 0.5, nh=4, tilt=2.2, dec=6, deck=2), t0 + (2 + k) * beat + r.integers(0, 2) * beat / 2, 0.1, 0.4 + 0.2 * r.random())
    t = np.arange(m.n + SR * 4) / SR
    ph = (t % beat) / beat
    pump = np.where(t < bar, 1.0, 0.45 + 0.55 * np.minimum(1, ph / 0.5) ** 1.4)
    for k in ('pad', 'stab'):
        if k in m.bus: m.bus[k] *= pump[:, None]
    fx = {'stab': dict(hi=4200, lo=180), 'pad': dict(hi=2200, lo=150), 'bass': dict(hi=700), 'lead': dict(hi=7000), 'drums': dict(hi=11000)}
    return m, fx, dict(rt=1.6, mix=0.2)


def happy(sec, seed):
    """Fröhlich und federnd: gezupfte Ukulele-Akkorde, Klatschen, Pfeif-Melodie, Glockenspiel."""
    bpm = 104; beat = 60 / bpm; bar = beat * 4
    # C – G – Am – F (I–V–vi–IV)
    prog = [[60, 64, 67, 72], [59, 62, 67, 71], [57, 60, 64, 69], [57, 60, 65, 69]]
    bass = [36, 31, 33, 29]
    mel = [[72, 74, 76, 79], [74, 71, 74, 79], [76, 72, 76, 81], [77, 72, 76, 74]]
    m = Mix(sec); r = np.random.default_rng(seed); bars = int(np.ceil(sec / bar)) + 1
    K, C, H = kick(0.8, 0.25), clap(), hat()
    strum = [0, 1, 1.5, 2.5, 3, 3.5]   # Ukulele-Anschlag: D-D-U-U-D-U
    for b in range(bars):
        t0 = b * bar; ch = prog[b % 4]
        for j, q in enumerate(strum):
            up = q % 1 != 0
            for i, n in enumerate(ch[::-1] if up else ch):
                m.add('uke', additive(hz(n), 0.5, nh=10, tilt=0.9, dec=8, deck=1.6), t0 + q * beat + i * 0.012, 0.075 * (0.7 if up else 1), 0.35 + 0.1 * i)
        for q in (0, 2):  # hüpfender Bass (Grundton – Quinte)
            for k, iv in enumerate((0, 7)):
                f = hz(bass[b % 4] + iv)
                s = additive(f, beat * 0.9, nh=5, tilt=1.6, dec=4, deck=0.6)
                m.add('bass', s, t0 + (q + k) * beat, 0.34)
        if b == 0: continue
        for q in range(4):
            m.add('drums', K, t0 + q * beat, 0.6 if q in (0, 2) else 0.3)
            if q in (1, 3): m.add('drums', C, t0 + q * beat, 0.45, 0.45 + 0.1 * (q == 3))
            m.add('drums', H, t0 + q * beat + beat / 2, 0.13, 0.65)
        if b >= 1:  # Pfeif-Melodie (Sinus mit Vibrato), jede zweite Phrase eine Oktave Glockenspiel dazu
            notes = mel[(b + seed) % 4]
            for k, n in enumerate(notes):
                d = beat * (1.5 if k % 2 == 0 else 0.5)
                at = t0 + [0, 1.5, 2, 3.5][k] * beat
                tw = tt(d * 1.1)
                vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * tw) * np.minimum(1, tw / 0.25)
                w = np.sin(2 * np.pi * np.cumsum(hz(n) * vib) / SR) * adsr(len(tw), 0.03, 0.3, 0.8, 0.08, d)
                w += filt(rng.standard_normal(len(tw)), lo=hz(n) * 0.9, hi=hz(n) * 1.2) * 0.04 * adsr(len(tw), 0.03, 0.3, 0.8, 0.08, d)
                m.add('whistle', w, at, 0.1, 0.5)
                if b % 2 == 0: m.add('glock', additive(hz(n + 12), 1.0, nh=3, tilt=2.5, dec=3, deck=1.5), at, 0.05, 0.6)
    fx = {'uke': dict(hi=6500, lo=200), 'bass': dict(hi=900), 'whistle': dict(hi=5000, lo=400), 'glock': dict(hi=9000), 'drums': dict(hi=10000)}
    return m, fx, dict(rt=1.3, mix=0.18)


def render(style, sec, seed):
    m, fx, rv = {'lofi': lofi, 'pop': pop, 'epic': epic, 'house': house, 'happy': happy}[style](sec, seed)
    out = np.zeros((m.n + SR * 4, 2))
    for k, b in m.bus.items():
        out += filt(b, **fx[k]) if k in fx else b
    out = reverb(out, **rv)[: m.n]
    out = np.tanh(out * 1.2) / np.tanh(1.2)  # sanft begrenzen
    n = len(out); fo = int(min(2.5, sec / 4) * SR)
    out[:int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))[:, None]
    out[n - fo:] *= (np.linspace(1, 0, fo) ** 1.5)[:, None]
    return out / np.abs(out).max() * 0.89


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('style', choices=['lofi', 'pop', 'epic', 'house', 'happy'])
    ap.add_argument('seconds', type=float)
    ap.add_argument('out')
    ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    y = render(a.style, a.seconds, a.seed)
    with wave.open(a.out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((y * 32767).astype('<i2').tobytes())
    print(f'Musik ({a.style}, {a.seconds:.1f} s) → {a.out}')
