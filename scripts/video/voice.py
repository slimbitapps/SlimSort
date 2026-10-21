"""Ein Sprechtext für ALLE Videos – und das Zerschneiden der fertigen Aufnahme.

  python3 scripts/video/voice.py text              → docs/SPRECHTEXT-ALLE.txt (zum Einsprechen in Clipchamp)
  python3 scripts/video/voice.py split AUFNAHME    → private/voice/<id>.wav je Video + Prüfbericht

Zwischen den Videos steht der Satz „Next video.“ (siehe scripts/video/videos.json). Beim Zerschneiden sucht die
Spracherkennung genau diesen Satz; klappt das nicht, helfen Wortanteil + längste Pause in der Nähe.
Die Trenn-Sätze selbst werden herausgeschnitten.
"""
import json, os, re, subprocess, sys, tempfile, wave

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'video', 'videos.json')))
VIDEOS = [v for v in CFG['videos'] if v.get('text')]   # Videos ohne Stimme (nur Musik) überspringen
MARKER = CFG['marker']
ALL = os.path.join(ROOT, 'docs', 'SPRECHTEXT-ALLE.txt')


def texts():
    return [open(os.path.join(ROOT, v['text'])).read().strip() for v in VIDEOS]


def make_text():
    body = f'\n\n{MARKER}\n\n'.join(texts()) + '\n'
    open(ALL, 'w').write(body)
    words = len(body.split())
    print(f'→ {ALL}  ({len(VIDEOS)} Videos, {words} Wörter, ca. {words / 2.9 / 60:.1f} min)')


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)


def recognize(wav):
    from pocketsphinx import Decoder
    d = Decoder(samprate=16000)
    w = wave.open(wav)
    d.start_utt(); d.process_raw(w.readframes(w.getnframes()), full_utt=True); d.end_utt()
    return [(s.start_frame / 100, s.end_frame / 100, re.sub(r'\(\d+\)$', '', s.word).lower()) for s in d.seg()
            if not s.word.startswith('<') and s.word not in ('[NOISE]', '[SPEECH]')]


def silences(wav, total):
    err = subprocess.run(['ffmpeg', '-i', wav, '-af', 'silencedetect=noise=-38dB:d=0.2', '-f', 'null', '-'], capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', err)]
    en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
    return [(a, b) for a, b in zip(st, en) if a > 0.05 and b < total - 0.05]


def split(audio):
    out = os.path.join(ROOT, 'private', 'voice')
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(tempfile.mkdtemp(), 'v.wav')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', tmp], check=True)
    total = dur(tmp)
    words = recognize(tmp)
    gaps = silences(tmp, total)
    counts = [len(t.split()) for t in texts()]
    mark_n = len(MARKER.split())
    all_n = sum(counts) + mark_n * (len(VIDEOS) - 1)
    # Kandidaten: „next“, direkt gefolgt von „video(s)“ – oder nur eins von beiden
    cands = []
    for i, (a, b, w) in enumerate(words):
        nxt = words[i + 1] if i + 1 < len(words) else None
        if w.startswith('next') and nxt and nxt[2].startswith('video') and nxt[0] - b < 0.6:
            cands.append((a, nxt[1], 2))
        elif w.startswith('video') and not (i and words[i - 1][2].startswith('next')):
            cands.append((a - 0.35, b, 1))
    cuts, used, report = [], set(), []
    for k in range(len(VIDEOS) - 1):
        n = sum(counts[: k + 1]) + mark_n * k
        expect = n / all_n * total
        near = [c for c in cands if abs(c[0] - expect) < total * 0.12 and c not in used]
        if near:
            c = min(near, key=lambda c: abs(c[0] - expect) - c[2] * 2)
            used.add(c)
            m0, m1, how = c[0], c[1], 'erkannt'
        else:
            # Rückfall: kurzes Stück Sprache (0,4–2,2 s) zwischen zwei Pausen nahe der erwarteten Stelle = Trenn-Satz
            # Bewertung: lange Pausen davor UND danach zählen viel, Abstand zur erwarteten Stelle wenig
            pairs = [(g1[1], g2[0], (g1[1] - g1[0]) + (g2[1] - g2[0])) for g1, g2 in zip(gaps, gaps[1:])
                     if 0.4 <= g2[0] - g1[1] <= 2.2 and abs(g1[1] - expect) < total * 0.1]
            if pairs:
                m0, m1, _ = max(pairs, key=lambda q: q[2] * 4 - abs(q[0] - expect) / 4)
            else:
                g = max([g for g in gaps if abs(g[0] - expect) < total * 0.1] or gaps, key=lambda g: g[1] - g[0])
                m0, m1 = g[1], g[1] + 0.9
            how = 'über Pausen gefunden – bitte Bericht prüfen'
        before = max([g for g in gaps if g[1] <= m0 + 0.05] or [(m0 - 0.2, m0)], key=lambda g: g[1])
        after = min([g for g in gaps if g[0] >= m1 - 0.05] or [(m1, m1 + 0.2)], key=lambda g: g[0])
        cuts.append(((before[0] + before[1]) / 2, (after[0] + after[1]) / 2))
        report.append(f'Trennung {k + 1}: „{MARKER}“ bei {m0:.2f}–{m1:.2f} s ({how})')
    bounds = [0.0] + [x for c in cuts for x in c] + [total]
    for i, v in enumerate(VIDEOS):
        a, b = bounds[2 * i], bounds[2 * i + 1]
        f = os.path.join(out, v['id'] + '.wav')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', audio,
                        '-af', f'afade=t=in:d=0.02,afade=t=out:st={max(0, b - a - 0.04):.3f}:d=0.04', '-ar', '48000', '-ac', '1', f], check=True)
        ws = [w for w in words if a <= w[0] < b]
        first = ' '.join(w[2] for w in ws[:4]); last = ' '.join(w[2] for w in ws[-4:])
        report.append(f'{v["title"]:8s} {a:6.2f}–{b:6.2f} s  ({b - a:5.1f} s, {len(ws)} Wörter erkannt / {counts[i]} im Text)  „{first} …“ → „… {last}“')
        if abs(len(ws) - counts[i]) > max(4, counts[i] * 0.15):
            report.append(f'   ⚠️  Wortzahl passt nicht zum Text – Schnitt bei {v["title"]} bitte von Hand prüfen')
    print('\n'.join(report))
    print('→', out)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'split':
        split(sys.argv[2])
    else:
        make_text()
