# Fertige Videos: nur noch Stimme + Musik drunter (DaVinci Resolve)

Du bekommst von Claude 8 fertig geschnittene Videos **ohne Ton**:

| Datei | Format | Länge | Sprechtext (`docs/SPRECHTEXT.md`) |
|---|---|---|---|
| `SlimSort-Intro.mp4` | 16:9 (YouTube) | 1:44 | Intro |
| `SlimSort-Short-1.mp4` | 9:16 (Shorts/TikTok/Reels) | ≈ 26 s | Short 1 |
| `SlimSort-Short-2.mp4` | 9:16 | ≈ 20 s | Short 2 |
| `SlimSort-Short-3.mp4` | 9:16 | ≈ 19 s | Short 3 |
| `SlimSort-Short-4.mp4` | 9:16 | ≈ 17 s | Short 4 |
| `SlimSort-Short-5.mp4` | 9:16 | ≈ 17 s | Short 5 |
| `SlimSort-Short-6.mp4` | 9:16 | ≈ 24 s | Short 6 |
| `SlimSort-Short-7-DE.mp4` | 9:16 | ≈ 26 s | Short 7 (Deutsch) |

---

## 1. Stimmen erzeugen (Clipchamp oder TTSMaker)
- **Intro:** jeden **Absatz einzeln** erzeugen und speichern als `intro-01.mp3`, `intro-02.mp3` … `intro-11.mp3`.
  (Ein Absatz = ein Block zwischen zwei Leerzeilen im Sprechtext.)
- **Shorts:** jeden Short am Stück erzeugen: `short-1.mp3` … `short-7.mp3`.

## 2. Intro in DaVinci
1. Neues Projekt → **Project Settings**: 1920×1080, **30 fps**.
2. `SlimSort-Intro.mp4` und alle `intro-XX.mp3` in den Media Pool ziehen.
3. Video auf **V1** legen (ganz an den Anfang).
4. Jeden Stimm-Absatz auf **A1** an die passende Zeit legen.
   Tipp: Oben links in der Timeline die Zeit eintippen, dann springt der Abspielkopf dorthin.

| Startzeit | Absatz | Beginnt mit … |
|---|---|---|
| 0:00 | 1 | You came back from vacation … |
| 0:08 | 2 | Sorting photos by hand is painful … |
| 0:17 | 3 | That's why I built SlimSort … |
| 0:28 | 4 | Pick the folder with your photos … |
| 0:44 | 5 | Now just look at each photo … |
| 0:55 | 6 | You'll be surprised … |
| 1:02 | 7 | And you can't break anything … |
| 1:11 | 8 | Took ten shots of the same moment? … |
| 1:26 | 9 | It's completely free … |
| 1:33 | 10 | Download SlimSort for free … |
| 1:37 | 11 | And subscribe … |

   Ist ein Absatz länger als seine Szene? Kein Problem: Den nächsten Absatz einfach etwas später
   anlegen, das Bild läuft weiter. Ist er kürzer, entsteht eine kleine Pause – die füllt die Musik.
5. **Musik** auf **A2** (YouTube Studio → Audio-Mediathek, z. B. Suchbegriff *corporate* oder *upbeat*,
   ohne Gesang). Lautstärke im Inspector auf **-22 dB**, am Ende 2 Sekunden ausblenden.
6. **Deliver** (Seite ganz rechts) → Preset **YouTube 1080p** → **Add to Render Queue** → **Render All**.

## 3. Shorts in DaVinci
1. Neues Projekt (oder neue Timeline) → **1080 × 1920**, 30 fps
   (Timeline anlegen: Rechtsklick im Media Pool → *Create New Timeline* → Haken bei *Use Project Settings* weg).
2. Video auf V1, Stimme auf A1 – **ab 0:00**. Der Short fängt sofort mit dem Hook-Text an, die Stimme auch.
3. Ist die Stimme länger als das Video? Das letzte Bild (Endkarte) etwas verlängern: Clip am Ende anfassen und ziehen.
   Ist sie kürzer? Video am Ende kürzen (die Endkarte bleibt mindestens 2 Sekunden).
4. Musik leise (-24 dB) auf A2. Export: Format MP4, H.264, Auflösung 1080 × 1920.
5. Beim Hochladen in YouTube/TikTok/Instagram: **automatische Untertitel einschalten** – viele schauen ohne Ton.

## 4. Hochladen – Titel & Beschreibung
Titel, Beschreibung und Tags stehen in `docs/VIDEO.md` (Abschnitt 3.7). Für Shorts:
- **Titel:** der Hook-Text, z. B. *„10 shots of the same moment – which one is sharp? #shorts“*
- **Beschreibung:** `Free download: slimbitapps.github.io/SlimSort` + 3 Hashtags (#photography #photoorganizer #freesoftware)
