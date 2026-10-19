# Video-Pipeline (Intro-Video + Shorts) – zum Wiederverwenden für jede SlimBit-App

Alles läuft in einer Linux-Cloud-Sitzung ohne Bildschirm: Xvfb, ffmpeg, Playwright/Chromium, Python 3 (numpy, Pillow).
Die Skripte liegen in `scripts/video/` dieses Repos (slimbitapps/SlimSort). Für eine neue App: Repo klonen und
den Ordner `scripts/video/` übernehmen; nur die Szenen (HTML) und die Aufnahme-Schritte sind app-spezifisch.

## Ablauf (Ergebnis wie bei SlimSort)
1. **Fotos/Inhalte des Nutzers** (z. B. ZIP) in den Arbeitsordner – nie committen.
   `prep-photos.py` erzeugt daraus Testdaten (Sortier-Fotos, Serien).
2. **Echte App aufnehmen:** `npm run build && node scripts/video/record-all.cjs WORK` → `WORK/raw/*.mkv` + `*.json`
   (Zeitmarken wie `grid`, `cmp`, `best`). Danach Einzelbilder je Clip nach `WORK/frames/<clip>/%05d.jpg`,
   kleine Fotos nach `WORK/thumbs/`, große nach `WORK/photos-hd/`.
3. **Sprechtext schreiben** (`docs/SPRECHTEXT-INTRO.txt`, `docs/shorts/shortN.txt`): Absätze durch Leerzeile getrennt,
   **ein Absatz = eine Szene**. Fließende Sätze statt Aufzählungen (KI-Stimmen klingen bei Listen unnatürlich).
   Englisch, kurze Sätze. Der Nutzer liest den Text in **Clipchamp** (Text-to-Speech) ein und schickt die .m4a.
4. **Stimme prüfen + aufteilen:**
   `python3 scripts/video/intro/words.py STIMME.m4a TEXT.txt` (zeigt Wörter mit Zeit + Vorschlag für Absatzgrenzen;
   vorher `pip install pocketsphinx`). **Zuerst prüfen, ob wirklich der richtige Text eingesprochen wurde.**
   Dann `[ALIGN_BOUNDS=…] python3 scripts/video/intro/align.py STIMME WORK TEXT NAME MIN1,MIN2,…`
   → `WORK/voice-NAME/absatz-XX.wav`, `voice-aligned-NAME.wav`, `durations-NAME.txt`.
5. **Rendern** (Bild für Bild, 30 fps):
   `node scripts/video/intro/render.cjs WORK --page SZENE.html --w 1080 --h 1920 --durations $(cat WORK/durations-NAME.txt) --text TEXT --voicedir WORK/voice-NAME --voice WORK/voice-aligned-NAME.wav --out WORK/out/NAME-master.mp4`
   - Kontrolle vorher: `--stills 1.5,6,12` (Standbilder) oder `--preview` (halbe Größe, schnell).
   - Nur Ton neu (z. B. Effekte leiser): `--audio-only`, dann Ton per ffmpeg ins vorhandene Video legen.
   - Intro: `--page scripts/video/intro/compositor.html --w 1920 --h 1080`.
6. **Fertig machen:** `ffmpeg -i master.mp4 -c:v libx264 -preset slow -crf 20 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k -ar 48000 -movflags +faststart FINAL.mp4`
   (Intro: `I=-15`). Untertitel fürs lange Video: `subtitles.py`. Danach **Sync prüfen**: `words.py FINAL.mp4`
   und Standbilder an den Schlüsselwörtern ansehen.
7. **Paket für den Nutzer:** Video, Thumbnail (1280×720 bzw. 1080×1920, großer Text + echtes Motiv),
   `UPLOAD.md` mit Titel, Beschreibung (Download-Link), Tags, max. 3 Hashtags, Kapitel (je ≥ 10 s), angepinntem
   Kommentar und Texten für TikTok/Instagram. Kanalbanner 2560×1440 (Inhalt in der Mitte 1546×423).

## Szenen bauen (`scripts/video/motion/core.js`)
- `scene(key, build, draw, span)` – `span` = wie viele Absätze die Szene dauert; `s.pOff` = Startzeiten der Absätze.
  **Ereignisse (Tastendruck, Einblendung) immer relativ zu `s.pOff` und der Absatzlänge setzen**, dann passen sie
  automatisch zur Stimme. Nach dem Einsprechen an die echten Wortzeiten (aus `words.py`) feinjustieren.
- `s.sfx = (D) => [{ t, type }]` – Soundeffekte `click`, `whoosh`, `whoosh-back`, `pop` (`motion/make-sfx.py`).
  Effekte werden automatisch leiser, solange gesprochen wird (Ducking in `render.cjs`).
- Helfer: `words/drawWords` (Text Wort für Wort), `laptopWin` + `place` (echte App im Laptop), `frame(clip, sek)`,
  `E`/`kf` (Easing/Keyframes), `start({ captionTop })` (Untertitel im Bild, Körnung, Vignette).
- Vorlagen: `shorts/short2.html` (Prinzip als Animation: Taste → Foto fliegt in Ordner),
  `shorts/short3.html` (Serie → Schärfstes → synchroner Zoom → Behalten), `intro/compositor.html` (Intro 16:9).

## Regeln, die sich bewährt haben
- Hook in der 1. Sekunde (Problem groß als Text). Ein Gedanke pro Short. 25–35 s.
- Prinzip **als saubere Animation** zeigen statt ruckelnder Bildschirmaufnahme; echte App kurz am Ende („✓ The real app“).
- Abschluss: Logo + „Free · Windows & Mac“ + „Link in profile“.
- Keine Maus-/Tastatur-Einblendungen über der echten App (wirkt unruhig). Wortenden der Stimme nie abschneiden.
- Fotos des Nutzers nie committen oder veröffentlichen.
