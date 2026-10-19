"""Schneidet Intro-Video und Shorts aus den Rohclips (ffmpeg).

  python3 scripts/video/edit.py ARBEITSORDNER
Ergebnis: ARBEITSORDNER/out/SlimSort-Intro.mp4, SlimSort-Short-1….mp4 und Zeitplan.txt
"""
import json, os, subprocess, sys, shutil
from urllib.parse import quote

WORK = os.path.abspath(sys.argv[1])
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(WORK, 'raw')
TMP = os.path.join(WORK, 'tmp')
OUT = os.path.join(WORK, 'out')
CARDS = os.path.join(WORK, 'cards')
for d in (TMP, OUT, CARDS):
    os.makedirs(d, exist_ok=True)

ICON = 'file://' + os.path.join(ROOT, 'build', 'icon.png')
MARK = 'file://' + os.path.join(ROOT, 'brand-site', 'logo-mark.png')
FPS = 30


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(' '.join(cmd))
        print(r.stderr[-3000:])
        raise SystemExit(1)


def marks(name):
    return {m['m']: m['t'] for m in json.load(open(os.path.join(RAW, name + '.json')))['marks']}


# ------------------------------------------------------------------ Karten
cards = []


def card(name, w, h, params, transparent=True):
    out = os.path.join(CARDS, name + '.png')
    cards.append({'out': out, 'w': w, 'h': h, 'params': params, 'transparent': transparent})
    return out


def render_cards():
    lst = os.path.join(TMP, 'cards.json')
    json.dump(cards, open(lst, 'w'))
    run(['node', os.path.join(ROOT, 'scripts', 'video', 'cards.cjs'), lst])


# ------------------------------------------------------------------ Segmente
def seg(out, src=None, a=0.0, b=None, speed=1.0, overlays=(), zoom=None, size=(1920, 1080), still=None, dur=None):
    """Ein Stück Video: Ausschnitt aus Rohclip (oder Standbild) mit Tempo, Zoom und Einblendungen.
    overlays: [(png, start, ende)] – Zeiten im fertigen Segment."""
    W, H = size
    cmd = ['ffmpeg', '-y', '-v', 'error']
    if still:
        D = dur
        cmd += ['-loop', '1', '-t', f'{D}', '-i', still]
        base = f'[0:v]fps={FPS},scale={W}:{H},setsar=1'
    else:
        D = (b - a) / speed
        cmd += ['-ss', f'{a}', '-to', f'{b}', '-i', os.path.join(RAW, src + '.mkv')]
        base = f'[0:v]setpts=(PTS-STARTPTS)/{speed},fps={FPS},scale={W}:{H},setsar=1'
    if zoom:
        z0, z1, cx, cy = zoom
        base += (f",scale=w='trunc({W}*({z0}+({z1}-{z0})*t/{D})/2)*2':h='trunc({H}*({z0}+({z1}-{z0})*t/{D})/2)*2':eval=frame:flags=lanczos"
                 f",crop={W}:{H}:x='(iw-{W})*{cx}':y='(ih-{H})*{cy}'")
    graph = [base + '[v0]']
    last = 'v0'
    for i, (png, s, e) in enumerate(overlays):
        cmd += ['-loop', '1', '-t', f'{D}', '-i', png]
        e = min(e, D)
        graph.append(f'[{i + 1}:v]format=rgba,fade=t=in:st={s}:d=0.35:alpha=1,fade=t=out:st={max(s, e - 0.35)}:d=0.35:alpha=1[o{i}]')
        graph.append(f"[{last}][o{i}]overlay=0:'if(lt(t-{s},0.35),(1-(t-{s})/0.35)*24,0)':enable='between(t,{s},{e})':eval=frame[v{i + 1}]")
        last = f'v{i + 1}'
    cmd += ['-filter_complex', ';'.join(graph), '-map', f'[{last}]', '-t', f'{D}', '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', str(FPS), out]
    run(cmd)
    return D


def concat(parts, out):
    lst = out + '.txt'
    with open(lst, 'w') as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', out])


def fmt(t):
    return f'{int(t // 60)}:{t % 60:04.1f}'


# ================================================================== Intro
def intro():
    m = marks('main')
    s = marks('series')
    W, H = 1920, 1080
    c = lambda name, params: card(name, W, H, params)
    t_title1 = c('i-title1', {'kind': 'title', 'h': '2,000 photos. 1 folder.', 'bottom': '120'})
    t_title2 = c('i-title2', {'kind': 'title', 'h': 'Drag. Drop. Scroll. Repeat.', 'bottom': '120'})
    t_logo = card('i-logo', W, H, {'kind': 'logo', 'icon': ICON, 'mark': MARK, 'tag': 'One key press per photo.'}, transparent=False)
    t_s1 = c('i-step1', {'kind': 'step', 'n': '1', 'h': 'Pick the folder with your photos', 'top': '880'})
    t_s2 = c('i-step2', {'kind': 'step', 'n': '2', 'h': 'Add target folders – each gets a key', 'top': '880'})
    t_s3 = c('i-step3', {'kind': 'step', 'n': '3', 'h': 'Press a key. The photo moves.'})
    t_fast = c('i-fast', {'kind': 'title', 'h': '≈ 1,000 photos in 10 minutes', 'pos': 'top'})
    t_safe = c('i-safe', {'kind': 'chips', 'items': 'Unlimited undo|Never overwrites|NAS-safe', 'bottom': '300'})
    t_series = c('i-series', {'kind': 'title', 'h': 'Finds bursts. Suggests the sharpest.', 'bottom': '170'})
    t_free = c('i-free', {'kind': 'chips', 'items': 'Free|No ads|No account|Works offline', 'bottom': '90'})
    t_web = c('i-web', {'kind': 'title', 'h': 'slimbitapps.github.io/SlimSort', 'p': 'Free download for Windows &amp; Mac', 'bottom': '90'})
    t_end = card('i-end', W, H, {'kind': 'end', 'icon': ICON, 'tag': 'Sort photos with one key press.', 'dl': '⬇ Free download – link below',
                                  'sub': 'Subscribe', 'url': 'slimbitapps.github.io/SlimSort'}, transparent=False)
    render_cards()

    P = []  # (Datei, Dauer, Abschnitt)
    def add(name, section, **kw):
        out = os.path.join(TMP, f'intro-{len(P):02d}.mp4')
        d = seg(out, **kw)
        P.append((out, d, section))

    add('chaos', 1, src='chaos', a=0.5, b=8.5, zoom=(1.0, 1.08, 0.5, 0.4), overlays=[(t_title1, 0.8, 7.7)])
    add('drag', 2, src='drag', a=0.3, b=9.6, overlays=[(t_title2, 1.0, 9.0)])
    add('logo', 3, still=t_logo, dur=4.8, zoom=(1.0, 1.05, 0.5, 0.5))
    add('teaser', 3, src='main', a=m['sorting'], b=m['sorting'] + 5.4, zoom=(1.12, 1.0, 0.5, 0.5))
    add('home', 4, src='main', a=m['home'], b=m['targets'] + 0.4, speed=1.25, overlays=[(t_s1, 0.3, 20)])
    add('targets', 4, src='main', a=m['targets'] + 0.4, b=m['targetsDone'] + 0.8, speed=2.0, overlays=[(t_s2, 0.2, 20)])
    add('start', 4, src='main', a=m['targetsDone'] + 0.8, b=m['sorting'], speed=2.4)
    add('sort', 5, src='main', a=m['sorting'] + 5.4, b=m['fast'], overlays=[(t_s3, 0.3, 4.5)])
    add('fast', 6, src='main', a=m['fast'], b=m['fastEnd'] + 0.4, overlays=[(t_fast, 0.4, 20)])
    add('safe', 7, src='main', a=m['undo'] - 0.2, b=m['nasEnd'], overlays=[(t_safe, 4.6, 20)])
    add('series', 8, src='series', a=s['cmp'] + 0.3, b=s['end'], overlays=[(t_series, 0.5, 5.5)])
    add('result', 9, src='result', a=0.3, b=7.8, overlays=[(t_free, 1.6, 20)])
    add('web', 10, src='web', a=0.6, b=4.6, overlays=[(t_web, 0.5, 20)])
    add('end', 11, still=t_end, dur=7.0)
    final = os.path.join(OUT, 'SlimSort-Intro.mp4')
    concat([p for p, _, _ in P], final)
    # Zeitplan: wann welcher Absatz des Sprechtextes beginnt
    starts = {}
    t = 0
    for _, d, sec in P:
        starts.setdefault(sec, t)
        t += d
    return final, starts, t


# ================================================================== Shorts
def shorts():
    W = 1080
    sq = marks('sq-sort-en')
    sqd = marks('sq-sort-de')
    ss = marks('sq-series')
    mask = card('mask', 1000, 1000, {'kind': 'mask', 'r': '44'}, transparent=False)
    defs = [
        ('1', 'en', 'POV: 2,000 vacation photos in ONE folder', [
            dict(src='sq-chaos', a=0.5, b=4.5),
            dict(src='sq-sort-en', a=sq['sorting'], b=sq['fastEnd'] + 0.3, zoom=(1.18, 1.18, 0.1, 0.85)),
            dict(src='sq-result', a=0.3, b=6.0)]),
        ('2', 'en', 'Still dragging photos into folders one by one?', [
            dict(src='sq-drag', a=0.3, b=8.6),
            dict(src='sq-sort-en', a=sq['sorting'], b=sq['fast'] + 0.2, zoom=(1.18, 1.18, 0.1, 0.85))]),
        ('3', 'en', '10 shots of the same moment. Which one is sharp?', [
            dict(src='sq-series', a=ss['cmp'] + 0.2, b=ss['end'], speed=0.85)]),
        ('4', 'en', 'I just moved 500 photos into the wrong folder…', [
            dict(src='sq-sort-en', a=sq['sorting'], b=sq['sorting'] + 4.0, zoom=(1.18, 1.18, 0.1, 0.85)),
            dict(src='sq-sort-en', a=sq['multi'], b=sq['end'])]),
        ('5', 'en', 'Sorting photos onto a NAS? Watch this.', [
            dict(src='sq-sort-en', a=sq['sorting'], b=sq['sorting'] + 6.0, zoom=(1.18, 1.18, 0.1, 0.85)),
            dict(src='sq-sort-en', a=sq['nas'] - 0.3, b=sq['multi'], zoom=(1.18, 1.18, 0.1, 0.85)),
            dict(src='sq-sort-en', a=sq['fast'], b=sq['fastEnd'], zoom=(1.18, 1.18, 0.1, 0.85))]),
        ('6', 'en', 'A photo app with no ads, no account, no cloud?', [
            dict(src='sq-sort-en', a=sq['fast'], b=sq['fastEnd'], zoom=(1.18, 1.18, 0.1, 0.85)),
            dict(src='sq-series', a=ss['zoom'] - 0.3, b=ss['move'] + 1.5),
            dict(src='sq-sort-en', a=sq['multi'] + 1.0, b=sq['multiUndo'] - 0.2)]),
        ('7-DE', 'de', '2.000 Urlaubsfotos in 10 Minuten sortieren?', [
            dict(src='sq-chaos-de', a=0.5, b=4.5),
            dict(src='sq-sort-de', a=sqd['sorting'], b=sqd['end'], zoom=(1.18, 1.18, 0.1, 0.85)),
            dict(src='sq-result-de', a=0.3, b=5.5)]),
    ]
    frames = {}
    for key, lang, hook, _ in defs:
        frames[key] = card('short-' + key, W, 1920, {
            'kind': 'short', 'hook': hook, 'icon': ICON,
            'foot': 'Kostenlos für Windows &amp; Mac' if lang == 'de' else 'Free for Windows &amp; Mac'}, transparent=False)
    ends = {
        'en': card('short-end-en', W, 1920, {'kind': 'shortend', 'icon': ICON, 'tag': 'Free for Windows &amp; Mac', 'dl': 'Link in profile'}, transparent=False),
        'de': card('short-end-de', W, 1920, {'kind': 'shortend', 'icon': ICON, 'tag': 'Kostenlos für Windows &amp; Mac', 'dl': 'Link im Profil'}, transparent=False),
    }
    render_cards()
    results = []
    for key, lang, hook, parts in defs:
        pieces = []
        for i, p in enumerate(parts):
            out = os.path.join(TMP, f'short{key}-{i}.mp4')
            seg(out, size=(W, W), **p)
            pieces.append(out)
        body = os.path.join(TMP, f'short{key}-body.mp4')
        concat(pieces, body)
        # in den Hochformat-Rahmen setzen (abgerundete Ecken)
        framed = os.path.join(TMP, f'short{key}-framed.mp4')
        bd = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', body], capture_output=True, text=True).stdout)
        run(['ffmpeg', '-y', '-v', 'error', '-i', body, '-loop', '1', '-t', f'{bd}', '-i', frames[key], '-loop', '1', '-t', f'{bd}', '-i', mask,
             '-filter_complex',
             '[0:v]scale=1000:1000,format=rgba[v];[2:v]format=gray,scale=1000:1000[m];[v][m]alphamerge[r];'
             '[1:v]format=rgba[bg];[bg][r]overlay=40:560:shortest=1,format=yuv420p[o]',
             '-map', '[o]', '-t', f'{bd}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-r', str(FPS), framed])
        endseg = os.path.join(TMP, f'short{key}-end.mp4')
        seg(endseg, still=ends[lang], dur=3.0, size=(W, 1920))
        final = os.path.join(OUT, f'SlimSort-Short-{key}.mp4')
        concat([framed, endseg], final)
        d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final], capture_output=True, text=True).stdout)
        results.append((final, d))
    return results


if __name__ == '__main__':
    what = sys.argv[2:] or ['intro', 'shorts']
    lines = []
    if 'intro' in what:
        final, starts, total = intro()
        names = {1: 'You came back from vacation…', 2: 'Sorting photos by hand is painful…', 3: "That's why I built SlimSort…",
                 4: 'Pick the folder with your photos…', 5: 'Now just look at each photo…', 6: "You'll be surprised…",
                 7: "And you can't break anything…", 8: 'Took ten shots of the same moment?…', 9: "It's completely free…",
                 10: 'Download SlimSort for free…', 11: 'And subscribe…'}
        lines.append(f'INTRO ({fmt(total)} Min.) – Absatz des Sprechtextes → Startzeit im Video')
        for sec, t in sorted(starts.items()):
            lines.append(f'  {fmt(t):>6}  Absatz {sec:>2}: {names[sec]}')
        print('\n'.join(lines))
    if 'shorts' in what:
        for f, d in shorts():
            lines.append(f'{os.path.basename(f)}: {d:.1f} s')
            print(lines[-1])
    open(os.path.join(OUT, 'Zeitplan.txt'), 'a').write('\n'.join(lines) + '\n')
