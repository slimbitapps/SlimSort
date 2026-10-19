"""Erzeugt Untertitel (SRT) aus Sprechtext + Absatz-Zeiten.
  python3 subtitles.py ARBEITSORDNER TEXTDATEI AUSGABE.srt
Zeiten: Szenenstarts (durations.txt) + Länge der Absätze (voice/absatz-XX.wav)."""
import os, re, subprocess, sys

WORK, TEXT, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
LEAD = 0.15
durs = [float(x) for x in open(os.path.join(WORK, 'durations.txt')).read().split(',')]
paras = [p.strip() for p in open(TEXT).read().split('\n\n') if p.strip()]


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)


def ts(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f'{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s % 1) * 1000):03d}'


def chunks(par):
    # Sätze, lange Sätze an Kommas teilen (max. ~80 Zeichen pro Untertitel)
    out = []
    for sent in re.split(r'(?<=[.?!])\s+', par):
        parts, cur = re.split(r'(?<=,)\s+', sent), ''
        for p in parts:
            if cur and len(cur) + len(p) > 80:
                out.append(cur)
                cur = p
            else:
                cur = (cur + ' ' + p).strip()
        if cur:
            out.append(cur)
    return out


lines, n, start = [], 0, 0.0
for i, par in enumerate(paras):
    a = start + LEAD + 0.2
    length = dur(os.path.join(WORK, 'voice', f'absatz-{i + 1:02d}.wav')) - 0.45
    cs = chunks(par)
    total = sum(len(c) for c in cs)
    t = a
    for c in cs:
        d = length * len(c) / total
        n += 1
        lines.append(f'{n}\n{ts(t)} --> {ts(t + d - 0.05)}\n{c}\n')
        t += d
    start += durs[i]
open(OUT, 'w').write('\n'.join(lines))
print(n, 'Untertitel →', OUT)
