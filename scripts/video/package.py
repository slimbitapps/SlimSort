"""Legt alle fertigen Videos, Bilder und Texte in einer IMMER GLEICHEN Ordnerstruktur ab und packt sie als ZIP.

  python3 scripts/video/package.py [AUSGABEORDNER=video-out] [--runde] [--fehlende-ok]
    ohne --runde   ALLE Videos des Projekts (fertige Runden + aktuelle) → <App>-Komplett.zip
    --runde        nur die aktuelle Runde aus videos.json               → <App>-Videos[-RundeN].zip
    --fehlende-ok  fehlende Dateien nicht abbrechen, sondern in LIESMICH.txt unter „Fehlt noch“ auflisten

Aufbau (bei jeder App gleich):
  <App>-…/
    Upload-Texte.html        ALLE Texte mit Kopier-Knöpfen (Titel, Beschreibung, Tags, Kommentar, TikTok, Instagram)
    Upload-Texte.txt         dasselbe als reiner Text
    LIESMICH.txt             was wo liegt + Reihenfolge zum Posten
    1-…/ 2-… 3-…             je Video ALLES zum Hochladen: Video.mp4 · Texte.html ·
                             YouTube-Cover/-Vorschaubild · TikTok-Cover · Instagram-Cover · Profilbilder (· Untertitel)
    Bilder-Posts/            Instagram-Feed-Posts, Story, Quadrat, YouTube-Community-Bild
    Kanal/                   Profilbilder + YouTube-Banner (einmalig einrichten)
    Logo-und-Screenshots/    App-Symbol, Logo, beschriftete Werbebilder
Pfade zu Logo/Profilbild/Banner/Screenshots: videos.json → "assets" (Standard = SlimClick-Aufbau).
"""
import glob, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'video', 'videos.json')))
APP = CFG['app']
args = [a for a in sys.argv[1:] if not a.startswith('--')]
ROUND, LAX = '--runde' in sys.argv, '--fehlende-ok' in sys.argv
OUT = os.path.abspath(args[0] if args else os.path.join(ROOT, 'video-out'))
TEXTS = os.path.join(ROOT, 'scripts', 'video', 'texts.py')
A = {'avatar': 'brand/slimbit-avatar-800.png', 'banner': 'brand/slimbit-youtube-banner-2560x1440.jpg',
     'logos': {'Symbol-1024.png': 'build/icon.png', 'Logo-512.png': 'brand/logo-square.png',
               'Symbol-256.png': 'brand/slimclick.png', 'Logo.svg': 'brand/logo.svg'},
     'screenshots': 'marketing/screenshots/en-*.png', 'srt': f'docs/{APP}-Intro-EN.srt', **CFG.get('assets', {})}
missing, copies = [], []  # copies: (Quelle, Ziel relativ zum Paket)


def need(p, what=None):
    p = p if os.path.isabs(p) else os.path.join(ROOT, p)
    if not os.path.exists(p):
        missing.append(what or os.path.relpath(p, ROOT))
        return None
    return p


def add(src, dst):
    if src: copies.append((src, dst))


if ROUND:
    VIDEOS = CFG['videos']
else:  # alle Runden durchnummerieren: 1-Intro, 2-Short1-…, …
    VIDEOS = [dict(v) for b in CFG.get('done', []) for v in b['videos']] + [dict(v) for v in CFG['videos']]
    for i, v in enumerate(VIDEOS):
        v['folder'] = f'{i + 1}-' + re.sub(r'^\d+-', '', v['folder'])

AVATAR, BANNER = need(A['avatar']), need(A['banner'])
for v in VIDEOS:
    d, name = v['folder'], v['title'].replace(' ', '')
    add(need(os.path.join(OUT, f'{APP}-{name}.mp4'), f'{d}/{name}.mp4  (Video {APP}-{name}.mp4)'), f'{d}/{name}.mp4')
    thumb = need(os.path.join(OUT, v['thumb']), f'{d}/  Titelbild {v["thumb"]}')
    if v['id'] == 'intro':
        add(thumb, f'{d}/YouTube-Vorschaubild-1280x720.jpg')
        add(need(A['srt']), f'{d}/YouTube-Untertitel-EN.srt')
        add(AVATAR, f'{d}/YouTube-Profilbild-800x800.png')
    else:
        for plat in ('YouTube', 'TikTok', 'Instagram'):
            add(thumb, f'{d}/{plat}-Cover-1080x1920.jpg')
            add(AVATAR, f'{d}/{plat}-Profilbild-800x800.png')

# Bilder-Posts (Namen wie in docs/upload/posts.json)
for src, dst in [('Post-1-Clicker', 'Instagram-Post1-Clicker-1080x1350'), ('Post-2-Laser', 'Instagram-Post2-Laser-1080x1350'),
                 ('Post-3-WiFi', 'Instagram-Post3-WiFi-1080x1350'), ('Story', 'Instagram-Story-1080x1920'),
                 ('Square', 'Instagram-Post-Quadrat-1080x1080'), ('Square', 'YouTube-Community-Beitrag-1080x1080')]:
    f = os.path.join(OUT, f'{APP}-{src}.jpg')
    if os.path.exists(f):
        add(f, f'Bilder-Posts/{dst}.jpg')
# Kanal (einmalig)
for p in ('YouTube', 'TikTok', 'Instagram'):
    add(AVATAR, f'Kanal/{p}-Profilbild-800x800.png')
add(BANNER, 'Kanal/YouTube-Banner-2560x1440.jpg')
# Logo + Screenshots
for dst, src in A['logos'].items():
    add(need(src), f'Logo-und-Screenshots/{APP}-{dst}')
for f in sorted(glob.glob(os.path.join(ROOT, A['screenshots']))):
    add(f, f'Logo-und-Screenshots/Screenshot-{re.sub(r"^en-", "", os.path.basename(f))}')
for v in VIDEOS:
    need(v['upload'])

if missing and not LAX:
    sys.exit('Es fehlen Dateien – zuerst rendern, thumbnails.cjs ausführen bzw. docs/upload/<id>.json anlegen:\n  ' + '\n  '.join(missing))

suffix = ('-Runde%d' % CFG['batch'] if CFG.get('batch', 1) > 1 else '') if ROUND else ''
NAME = f'{APP}-Videos{suffix}' if ROUND else f'{APP}-Komplett'
tmp = tempfile.mkdtemp()
Z = os.path.join(tmp, NAME)
for src, dst in copies:
    p = os.path.join(Z, dst)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    shutil.copy2(src, p)
# Texte (Ordnernamen für die Kopierseite mitgeben)
ids = [v['id'] for v in VIDEOS]
folders = json.dumps({v['id']: v['folder'] for v in VIDEOS})
run = lambda *a: subprocess.run([sys.executable, TEXTS, *a], check=True, capture_output=True, env={**os.environ, 'FOLDERS': folders})
run('html', os.path.join(Z, 'Upload-Texte.html'), *ids)
run('txt', os.path.join(Z, 'Upload-Texte.txt'), *ids)
for v in VIDEOS:
    os.makedirs(os.path.join(Z, v['folder']), exist_ok=True)
    run('html', os.path.join(Z, v['folder'], 'Texte.html'), v['id'])

order = '\n'.join(f'  {i + 1}. {v["title"]:8s} → Ordner {v["folder"]}' for i, v in enumerate(VIDEOS))
todo = ('\nFehlt noch (bitte schicken, dann packe ich das ZIP neu):\n  ' + '\n  '.join(missing) + '\n') if missing else ''
open(os.path.join(Z, 'LIESMICH.txt'), 'w').write(f"""{APP} – Videos, Bilder und Texte
{todo}
Am einfachsten: Upload-Texte.html doppelklicken – dort hat jedes Textfeld einen Kopieren-Knopf.

So ist der Ordner aufgebaut (bei jeder App gleich):
  Upload-Texte.html        alle Texte mit Kopier-Knöpfen (auch als Upload-Texte.txt)
  1-… 2-… 3-…              je Video ALLES zum Hochladen: das Video, Texte.html, Cover und Profilbild
                           für YouTube, TikTok und Instagram (Dateiname beginnt mit der Plattform)
  Bilder-Posts/            Bilder für Instagram-Feed, Story und YouTube-Community (Texte in Upload-Texte.html)
  Kanal/                   Profilbilder und YouTube-Banner – nur einmal beim Einrichten der Kanäle
  Logo-und-Screenshots/    App-Symbol, Logo, Werbebilder

Reihenfolge zum Posten (Abstand 2–3 Tage, So–Do 18–20 Uhr):
{order}

Titelbild: Neue Videos beginnen mit einer halben Sekunde Deckblatt. Beim Hochladen als Cover den Regler
ganz an den Anfang schieben. (Eigene Bilder hochladen geht bei deinem YouTube-Konto noch nicht.)
""")
zf = os.path.join(OUT, NAME + '.zip')
os.makedirs(OUT, exist_ok=True)
if os.path.exists(zf):
    os.remove(zf)
subprocess.run(['zip', '-qr', zf, NAME], cwd=tmp, check=True)
shutil.rmtree(os.path.join(OUT, NAME), ignore_errors=True)
shutil.copytree(Z, os.path.join(OUT, NAME))  # entpackt zum Ansehen
shutil.rmtree(tmp)
n = sum(len(fs) for _, _, fs in os.walk(os.path.join(OUT, NAME)))
print(f'→ {zf} ({os.path.getsize(zf) / 1e6:.0f} MB, {n} Dateien)' + (f' – {len(missing)} fehlen noch' if missing else ''))
