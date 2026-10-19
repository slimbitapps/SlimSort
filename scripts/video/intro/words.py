"""Zeigt, welches Wort wann gesprochen wird (offline, ohne Internet) – zum Prüfen der Stimme.

  pip install pocketsphinx   (einmalig; bringt ein englisches Modell mit)
  python3 words.py STIMME.m4a [SPRECHTEXT.txt]
Ausgabe: Wörter mit Zeit + Pausen. Mit Sprechtext zusätzlich ein Vorschlag für ALIGN_BOUNDS
(Mitte der Pause vor dem ersten Wort jedes Absatzes) – bitte mit der Wortliste gegenprüfen.
"""
import os, re, subprocess, sys, tempfile, wave
from pocketsphinx import Decoder

VOICE = sys.argv[1]
wav = os.path.join(tempfile.mkdtemp(), 'v.wav')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', VOICE, '-ac', '1', '-ar', '16000', wav], check=True)
d = Decoder(samprate=16000)
w = wave.open(wav)
d.start_utt(); d.process_raw(w.readframes(w.getnframes()), full_utt=True); d.end_utt()
words = [(s.start_frame / 100, re.sub(r'\(\d+\)$', '', s.word)) for s in d.seg() if not s.word.startswith('<') and s.word != '[NOISE]']
print(' '.join(f'{t:.2f}:{x}' for t, x in words))

err = subprocess.run(['ffmpeg', '-i', wav, '-af', 'silencedetect=noise=-38dB:d=0.15', '-f', 'null', '-'], capture_output=True, text=True).stderr
st = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', err)]
en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
gaps = [(a, b) for a, b in zip(st, en) if a > 0.05]
print('Pausen:', ' '.join(f'{a:.2f}–{b:.2f}' for a, b in gaps))

if len(sys.argv) > 2:
    paras = [p.split() for p in open(sys.argv[2]).read().split('\n\n') if p.strip()]
    total = sum(len(p) for p in paras)
    bounds, n = [], 0
    for p in paras[:-1]:
        n += len(p)
        # Absatzanfang ungefähr über den Wortanteil, dann die nächste passende Pause wählen
        est = words[min(len(words) - 1, round(n / total * len(words)))][0]
        g = min(gaps, key=lambda g: abs((g[0] + g[1]) / 2 - est) - (g[1] - g[0]) * 2)
        bounds.append(round((g[0] + g[1]) / 2, 2))
    print('Vorschlag: ALIGN_BOUNDS=' + ','.join(str(b) for b in bounds))
