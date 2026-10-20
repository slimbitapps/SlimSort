"""Upload-Texte: strukturierte Daten → HTML-Seite mit Kopier-Knöpfen + einfache Text-Datei.

  python3 scripts/video/texts.py import        einmalig: docs/**/UPLOAD.md → docs/upload/<id>.json
  python3 scripts/video/texts.py html OUT.html [id …]   Kopierseite (alle Videos der Runde, oder nur die genannten)
  python3 scripts/video/texts.py txt  OUT.txt  [id …]   gleiche Inhalte als reiner Text

Quelle je Video: docs/upload/<id>.json mit den Feldern
  youtube: { title, description, tags, pinned }, tiktok: { caption }, instagram: { caption },
  hints: [ "Titelbild: …", "Wann posten: …" ]
Bilder-Posts (Instagram-Feed, Story, Community): docs/upload/posts.json  → [{ name, image, text }]
Kein Sprechtext – nur was man beim Hochladen braucht.
"""
import html, json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'video', 'videos.json')))
UP = os.path.join(ROOT, 'docs', 'upload')
APP = CFG['app']


def all_videos():
    vs = [v for b in CFG.get('done', []) for v in b['videos']] + CFG['videos']
    fo = json.loads(os.environ.get('FOLDERS', '{}'))  # package.py nummeriert im Komplett-Paket neu
    return {v['id']: {**v, 'folder': fo.get(v['id'], v['folder'])} for v in vs}


# ---------------------------------------------------------------- Import aus den alten Markdown-Anleitungen
def parse_md(md):
    blocks, head, label, inside, buf, notes = [], '', '', False, [], {}
    for ln in md.splitlines():
        if ln.strip().startswith('```'):
            if inside:
                blocks.append((head, label, '\n'.join(buf).strip()))
                buf = []
            inside = not inside
            continue
        if inside:
            buf.append(ln)
            continue
        if ln.startswith('#'):
            head, label = ln.lstrip('#').strip(), ''
        elif ln.strip().startswith('**') and ln.strip().endswith((':**', '**', ':')):
            label = ln.strip()
        elif ln.strip().startswith('- ') and re.search(r'wann posten', head, re.I):
            notes.setdefault('when', []).append(re.sub(r'\*\*', '', ln.strip()[2:]))
        elif re.match(r'^- \*\*Titelbild', ln.strip()):
            notes['cover'] = re.sub(r'\*\*', '', ln.strip()[2:])
    out = {'youtube': {}, 'tiktok': {}, 'instagram': {}, 'hints': []}
    for h, lab, txt in blocks:
        key = (h + ' ' + lab).lower()
        if 'tiktok' in key and 'instagram' in key:
            out['tiktok']['caption'] = out['tiktok'].get('caption') or txt
            out['instagram']['caption'] = out['instagram'].get('caption') or txt
        elif 'tiktok' in key:
            out['tiktok']['caption'] = txt
        elif 'instagram' in key:
            out['instagram']['caption'] = txt
        elif 'kommentar' in key:
            out['youtube']['pinned'] = txt
        elif 'tags' in key:
            out['youtube']['tags'] = txt
        elif 'beschreibung' in key and 'description' not in out['youtube']:
            out['youtube']['description'] = txt
        elif 'titel' in key and 'title' not in out['youtube']:
            out['youtube']['title'] = txt
    if notes.get('cover'):
        out['hints'].append(notes['cover'])
    else:
        out['hints'].append('Titelbild: Das Video beginnt mit einer halben Sekunde Deckblatt – beim Hochladen als Cover den Regler ganz an den Anfang schieben.')
    out['hints'] += ['Wann posten: ' + w for w in notes.get('when', [])]
    return out


def do_import():
    os.makedirs(UP, exist_ok=True)
    for vid, v in all_videos().items():
        src = os.path.join(ROOT, v.get('upload', ''))
        dst = os.path.join(UP, vid + '.json')
        if src.endswith('.md') and os.path.exists(src) and not os.path.exists(dst):
            json.dump(parse_md(open(src).read()), open(dst, 'w'), indent=2, ensure_ascii=False)
            print('→', os.path.relpath(dst, ROOT))
    posts = os.path.join(UP, 'posts.json')
    sp = os.path.join(ROOT, 'docs', 'SOCIAL-POSTS.md')
    if os.path.exists(sp) and not os.path.exists(posts):
        items, cur = [], None
        for ln in open(sp).read().split('\n'):
            if ln.startswith('## ') and '–' in ln:
                cur = {'name': ln[3:].split('–')[0].strip(), 'image': ln.split('–', 1)[1].strip(), 'text': ''}
                items.append(cur)
            elif cur is not None and not ln.startswith('```') and not ln.startswith('## '):
                cur['text'] += ln + '\n'
        for it in items:
            it['text'] = re.sub(r'^\(.*?\)\n', '', it['text'].strip()).strip()
        json.dump(items, open(posts, 'w'), indent=2, ensure_ascii=False)
        print('→', os.path.relpath(posts, ROOT))


# ---------------------------------------------------------------- Ausgabe
def load(ids):
    av = all_videos()
    out = []
    for i in ids:
        f = os.path.join(UP, i + '.json')
        if not os.path.exists(f):
            sys.exit(f'Es fehlen die Upload-Texte: {os.path.relpath(f, ROOT)}')
        out.append((av[i], json.load(open(f))))
    posts = os.path.join(UP, 'posts.json')
    return out, (json.load(open(posts)) if os.path.exists(posts) else [])


FIELDS = [('youtube', 'title', 'Titel'), ('youtube', 'description', 'Beschreibung'), ('youtube', 'tags', 'Tags (YouTube Studio → „Mehr anzeigen“)'),
          ('youtube', 'pinned', 'Angepinnter Kommentar'), ('tiktok', 'caption', 'Text'), ('instagram', 'caption', 'Text')]
PLATFORMS = [('youtube', 'YouTube', '#ff3b30'), ('tiktok', 'TikTok', '#25f4ee'), ('instagram', 'Instagram', '#e1306c')]


def make_txt(items, posts):
    L = [f'{APP} – Upload-Texte (zum Kopieren)', '']
    for v, d in items:
        L += ['=' * 60, v['title'].upper() + f"   (Ordner {v['folder']})", '=' * 60]
        for pk, pname, _ in PLATFORMS:
            L += ['', f'--- {pname} ---']
            for k, f, lab in FIELDS:
                if k == pk and d.get(k, {}).get(f):
                    L += [f'[{lab}]', d[k][f], '']
        if d.get('hints'):
            L += ['--- Hinweise ---'] + ['- ' + h for h in d['hints']] + ['']
    if posts:
        L += ['=' * 60, 'BILDER-POSTS (Ordner Bilder-Posts)', '=' * 60]
        for p in posts:
            L += ['', f"[{p['name']} – {p['image']}]", p['text']]
    return '\n'.join(L).rstrip() + '\n'


def make_html(items, posts):
    e = lambda s: html.escape(s or '')
    n = [0]

    def box(label, text):
        n[0] += 1
        rows = max(2, min(14, text.count('\n') + 2 + len(text) // 70))
        return f'''<div class="f"><div class="fl"><span>{e(label)}</span><button data-t="t{n[0]}">Kopieren</button></div>
<textarea id="t{n[0]}" rows="{rows}" readonly>{e(text)}</textarea></div>'''

    nav, secs = [], []
    for v, d in items:
        sid = v['id']
        nav.append(f'<a href="#{sid}">{e(v["title"])}</a>')
        cards = []
        for pk, pname, col in PLATFORMS:
            fs = [box(lab, d[k][f]) for k, f, lab in FIELDS if k == pk and d.get(k, {}).get(f)]
            if fs:
                cards.append(f'<div class="card"><h3><i style="background:{col}"></i>{pname}</h3>{"".join(fs)}</div>')
        hints = ''.join(f'<li>{e(h)}</li>' for h in d.get('hints', []))
        secs.append(f'''<section id="{sid}"><h2>{e(v["title"])} <small>Ordner {e(v["folder"])}</small></h2>
<div class="cards">{"".join(cards)}</div>{f'<ul class="hints">{hints}</ul>' if hints else ''}</section>''')
    if posts:
        nav.append('<a href="#posts">Bilder-Posts</a>')
        secs.append('<section id="posts"><h2>Bilder-Posts <small>Ordner Bilder-Posts</small></h2><div class="cards">' +
                    ''.join(f'<div class="card"><h3>{e(p["name"])}</h3><p class="img">{e(p["image"])}</p>{box("Text", p["text"])}</div>' for p in posts) +
                    '</div></section>')
    return f'''<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{APP} – Upload-Texte</title>
<style>
:root{{--bg:#f5f5f7;--card:#fff;--text:#1c1c1f;--muted:#6b6f78;--line:#e3e4e8;--acc:#e5294f}}
@media (prefers-color-scheme:dark){{:root{{--bg:#111216;--card:#1b1c21;--text:#f1f2f4;--muted:#a4a8b1;--line:#2b2c32;--acc:#ff4d6d}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
header{{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}}
header b{{font-size:17px;margin-right:8px}}header a{{color:var(--text);text-decoration:none;padding:6px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-weight:600;font-size:14px}}
main{{max-width:1180px;margin:0 auto;padding:10px 20px 60px}}section{{margin-top:26px}}h2{{margin:0 0 12px;font-size:22px}}h2 small{{font-size:13px;color:var(--muted);font-weight:500;margin-left:8px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}}.card{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}}
h3{{margin:0 0 10px;font-size:16px;display:flex;align-items:center;gap:8px}}h3 i{{width:10px;height:10px;border-radius:50%;display:inline-block}}
.f{{margin-bottom:12px}}.fl{{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px;color:var(--muted);font-weight:600}}
textarea{{width:100%;resize:vertical;overflow:hidden;border:1px solid var(--line);border-radius:10px;padding:9px 10px;font:13.5px/1.45 ui-monospace,Menlo,monospace;background:var(--bg);color:var(--text)}}
button{{border:0;border-radius:8px;padding:6px 14px;font:600 13px -apple-system,sans-serif;background:var(--acc);color:#fff;cursor:pointer;min-width:96px}}button.ok{{background:#1f9d5a}}
.hints{{margin:12px 0 0;padding-left:20px;color:var(--muted);font-size:14px}}.img{{margin:-4px 0 10px;color:var(--muted);font-size:13px}}
</style></head><body>
<header><b>{APP} · Upload-Texte</b>{"".join(nav)}</header>
<main>{"".join(secs)}</main>
<script>
// Felder so hoch wie ihr Text (nichts abgeschnitten)
const fit=()=>document.querySelectorAll('textarea').forEach(t=>{{t.style.height='auto';t.style.height=(t.scrollHeight+2)+'px'}});
addEventListener('load',fit);addEventListener('resize',fit);
document.querySelectorAll('button[data-t]').forEach(b=>b.onclick=async()=>{{
  const t=document.getElementById(b.dataset.t);
  try{{await navigator.clipboard.writeText(t.value)}}catch(_){{t.select();document.execCommand('copy');getSelection().removeAllRanges()}}
  b.textContent='✓ Kopiert';b.classList.add('ok');setTimeout(()=>{{b.textContent='Kopieren';b.classList.remove('ok')}},1600);
}});
</script></body></html>
'''


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'html'
    if cmd == 'import':
        do_import()
    else:
        out = sys.argv[2]
        ids = sys.argv[3:] or [v['id'] for v in CFG['videos']]
        items, posts = load(ids)
        if len(ids) == 1:
            posts = []
        open(out, 'w').write(make_html(items, posts) if cmd == 'html' else make_txt(items, posts))
        print('→', out)
