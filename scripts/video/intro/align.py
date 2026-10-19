"""Passt das Intro an die gesprochene Stimme an.

  python3 align.py STIMME.mp3 ARBEITSORDNER [TEXTDATEI] [NAME] [MIN1,MIN2,…]
Findet die 11 Absätze (längste Pausen), schneidet sie einzeln aus und berechnet
Szenenlängen, sodass jede Szene zu ihrem Absatz passt. Ergebnis:
  ARBEITSORDNER/voice/absatz-XX.wav, voice-aligned.wav, durations.txt
"""
import os, re, subprocess, sys

VOICE, WORK = sys.argv[1], os.path.abspath(sys.argv[2])
TEXT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), '..', '..', '..', 'docs', 'SPRECHTEXT-INTRO.txt')
NAME = sys.argv[4] if len(sys.argv) > 4 else ''   # z. B. "short1" → voice-short1/, durations-short1.txt
paras_txt = [p for p in open(TEXT).read().split('\n\n') if p.strip()]
N = len(paras_txt)
# Mindestlänge je Szene (die Animationen brauchen etwas Zeit)
MIN = [float(x) for x in sys.argv[5].split(',')] if len(sys.argv) > 5 else ([6.0, 9.0, 4.8, 7.5, 9.5, 5.5, 10.0, 12.0, 8.0, 7.0, 7.0] if N == 11 else [2.5] * N)
LEAD = 0.15   # Stimme beginnt kurz nach dem Szenenwechsel (Absätze enthalten schon etwas Stille)
TAIL = 0.35   # kleine Pause nach jedem Absatz
OUT = os.path.join(WORK, 'voice' + ('-' + NAME if NAME else ''))
os.makedirs(OUT, exist_ok=True)


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)


total = dur(VOICE)


def detect(noise, d):
    err = subprocess.run(['ffmpeg', '-i', VOICE, '-af', f'silencedetect=noise={noise}dB:d={d}', '-f', 'null', '-'], capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', err)]
    en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
    return [(e - s, s, e) for s, e in zip(st, en) if s > 0.3 and e < total - 0.3]


words = [len(p.split()) for p in paras_txt]
# Jedes Komma/jeder Punkt im Text ergibt eine Sprechpause. Finden wir genau so viele Pausen,
# lassen sich die Absatzgrenzen sicher abzählen.
inner = [len(re.findall(r'[,.?!;:]', p.strip()[:-1])) for p in paras_txt]
expected = sum(inner) + N - 1
cuts, best_spread = None, 9.0
for d in (0.12, 0.15, 0.18, 0.2, 0.22, 0.25, 0.3):
    for noise in (-35, -38, -40, -42, -45):
        g = detect(noise, d)
        if len(g) != expected:
            continue
        idx, cand = 0, []
        for i in range(N - 1):
            idx += inner[i]
            cand.append(g[idx])
            idx += 1
        # Plausibilität: Sprechtempo (Wörter pro Sekunde) sollte in allen Absätzen ähnlich sein
        b = [0.0] + [(x[1] + x[2]) / 2 for x in cand] + [total]
        rates = [words[i] / max(0.1, b[i + 1] - b[i]) for i in range(N)]
        spread = max(rates) / min(rates)
        if spread < best_spread:
            cuts, best_spread = cand, spread
if cuts and best_spread > 1.45:
    cuts = None
if cuts:
    print('Absätze über Satzzeichen erkannt')
else:
    # Rückfall: Absatzgrenzen anhand der Wortzahl schätzen
    gaps = detect(-38, 0.25)
    if len(gaps) < N - 1:
        sys.exit(f'Nur {len(gaps)} Pausen gefunden – erwartet {N - 1}.')
    cuts, last = [], 0.0
    for i in range(1, N):
        expect = sum(words[:i]) / sum(words) * total
        rest = N - 1 - i
        later = [g for g in gaps if g[1] > last]
        cand = later[: len(later) - rest] if rest else later
        best = min(cand, key=lambda g: abs(g[1] - expect) / 3.0 - g[0] * 4)
        cuts.append(best)
        last = best[1]
    print('Absätze geschätzt (bitte Ergebnis prüfen)')
bounds = [0.0] + [(s + e) / 2 for _, s, e in cuts] + [total]
# Absatzgrenzen von Hand (Sekunden), falls die Erkennung danebenliegt: ALIGN_BOUNDS=4.96,8.01,…
if os.environ.get('ALIGN_BOUNDS'):
    bounds = [0.0] + [float(x) for x in os.environ['ALIGN_BOUNDS'].split(',')] + [total]
    assert len(bounds) == N + 1, f'ALIGN_BOUNDS braucht {N - 1} Werte'
    print('Absatzgrenzen von Hand gesetzt')

paras, lens = [], []
for i in range(N):
    a, b = bounds[i], bounds[i + 1]
    f = os.path.join(OUT, f'absatz-{i + 1:02d}.wav')
    # Stille am Anfang/Ende jedes Absatzes abschneiden
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(a), '-to', str(b), '-i', VOICE,
                    # nichts wegschneiden (sonst fehlen leise Wortenden) – nur ganz kurz ein-/ausblenden
                    '-af', f'afade=t=in:d=0.03,afade=t=out:st={max(0, b - a - 0.05)}:d=0.05',
                    '-ar', '48000', '-ac', '1', f], check=True)
    paras.append(f)
    lens.append(dur(f))

durs = [max(MIN[i], LEAD + lens[i] + TAIL) for i in range(N)]
t, inputs, filt = 0.0, [], []
for i, f in enumerate(paras):
    inputs += ['-i', f]
    ms = int((t + LEAD) * 1000)
    filt.append(f'[{i}:a]adelay={ms}|{ms}[a{i}]')
    t += durs[i]
filt.append(''.join(f'[a{i}]' for i in range(N)) + f'amix=inputs={N}:normalize=0,apad=whole_dur={t:.2f}[out]')
aligned = os.path.join(WORK, 'voice-aligned' + ('-' + NAME if NAME else '') + '.wav')
subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', aligned], check=True)
open(os.path.join(WORK, 'durations' + ('-' + NAME if NAME else '') + '.txt'), 'w').write(','.join(f'{d:.2f}' for d in durs))
for i in range(N):
    print(f'Absatz {i + 1:2d}: Stimme {lens[i]:5.1f} s → Szene {durs[i]:5.1f} s')
print(f'Gesamt: {t:.1f} s')
