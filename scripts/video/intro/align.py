"""Passt das Intro an die gesprochene Stimme an.

  python3 align.py STIMME.mp3 ARBEITSORDNER
Findet die 11 Absätze (längste Pausen), schneidet sie einzeln aus und berechnet
Szenenlängen, sodass jede Szene zu ihrem Absatz passt. Ergebnis:
  ARBEITSORDNER/voice/absatz-XX.wav, voice-aligned.wav, durations.txt
"""
import os, re, subprocess, sys

VOICE, WORK = sys.argv[1], os.path.abspath(sys.argv[2])
N = 11
# Mindestlänge je Szene (die Animationen brauchen etwas Zeit)
MIN = [6.0, 9.0, 4.8, 7.5, 9.5, 5.5, 10.0, 12.0, 8.0, 7.0, 7.0]
LEAD = 0.35   # Stimme beginnt kurz nach dem Szenenwechsel
TAIL = 0.6    # kleine Pause nach jedem Absatz
OUT = os.path.join(WORK, 'voice')
os.makedirs(OUT, exist_ok=True)


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)


total = dur(VOICE)
err = subprocess.run(['ffmpeg', '-i', VOICE, '-af', 'silencedetect=noise=-38dB:d=0.25', '-f', 'null', '-'], capture_output=True, text=True).stderr
starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', err)]
ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
gaps = [(e - s, s, e) for s, e in zip(starts, ends) if s > 0.3 and e < total - 0.3]
if len(gaps) < N - 1:
    sys.exit(f'Nur {len(gaps)} Pausen gefunden – erwartet {N - 1}. Bitte zwischen den Absätzen Leerzeilen lassen.')
cuts = sorted(sorted(gaps, reverse=True)[:N - 1], key=lambda g: g[1])
bounds = [0.0] + [(s + e) / 2 for _, s, e in cuts] + [total]
lead_sil = ends[0] if starts and starts[0] < 0.05 else 0.0

paras, lens = [], []
for i in range(N):
    a, b = bounds[i], bounds[i + 1]
    f = os.path.join(OUT, f'absatz-{i + 1:02d}.wav')
    # Stille am Anfang/Ende jedes Absatzes abschneiden
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(a), '-to', str(b), '-i', VOICE,
                    '-af', 'silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-40dB,areverse',
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
aligned = os.path.join(WORK, 'voice-aligned.wav')
subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', aligned], check=True)
open(os.path.join(WORK, 'durations.txt'), 'w').write(','.join(f'{d:.2f}' for d in durs))
for i in range(N):
    print(f'Absatz {i + 1:2d}: Stimme {lens[i]:5.1f} s → Szene {durs[i]:5.1f} s')
print(f'Gesamt: {t:.1f} s')
