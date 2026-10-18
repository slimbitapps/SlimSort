# Veröffentlichungs- & Werbeplan – SlimBit Apps / Fotosortierer

So bringst du den Fotosortierer **kostenlos, professionell und ohne Gewerbe** raus – und so,
dass jede weitere App später genauso einfach dazukommt.

> Arbeite den Plan **von oben nach unten** ab. Jeder Schritt hat ein ☐ zum Abhaken.
> Wo „→ Claude“ steht, sagst du mir einfach Bescheid und ich erledige den Teil.

---

## Teil 0 – Ist die App fertig für die Veröffentlichung?

Ich habe alles geprüft. **Kurz gesagt: Die App selbst ist fertig.** Was fehlt, sind nur noch Dinge
„drumherum“ (Konten, Adressen, Texte), die nur du erledigen kannst.

| Bereich | Stand |
|---|---|
| Funktionen (Sortieren, Rückgängig, NAS, Serien, Vergleich) | ✅ fertig, automatische Tests bestehen |
| Installer für Windows und Mac | ✅ werden bei jedem Hochladen automatisch gebaut |
| Download-Seite | ✅ fertig, erkennt automatisch Windows/Mac |
| Startseite „SlimBit Apps“ | ✅ fertig gebaut (Ordner `brand-site/`), muss noch online (Schritt A2) |
| Link zur Startseite in der App (Einstellungen → Über die App) | ✅ eingebaut |
| Impressum & Datenschutz | ⚠️ Vorlage fertig, **deine Daten fehlen noch** (Schritt A4) |
| Test auf einem echten Windows-PC | ⚠️ noch offen (Schritt A5) |
| Name des Repositorys | ⚠️ Tippfehler `fotosortierter` (Schritt A3) |
| Microsoft-Store-Daten in der App | ⚠️ Platzhalter, kommen aus Schritt B2 |
| Warnung beim ersten Öffnen auf dem Mac | ℹ️ bleibt ohne Apple-Konto (99 $/Jahr). Die Download-Seite erklärt das Wegklicken. |
| Versionsnummer | ℹ️ steht auf 0.3 → wird zum Start **1.0** (Schritt A6) |

---

## Teil A – Vorbereitung (ca. 1–2 Abende)

### ☐ A1. Eine eigene E-Mail-Adresse für SlimBit Apps
Für alle Konten (Store, YouTube, Reddit …) und als Kontakt-Adresse auf der Website.
1. Kostenloses Postfach anlegen, z. B. `slimbitapps@gmail.com` (oder ähnlich).
2. Diese Adresse überall verwenden – so bleibt dein privates Postfach getrennt.

### ☐ A2. Startseite online stellen (`https://slimbitapps.github.io`)
1. Auf github.com einloggen → oben rechts **+** → **New repository**.
2. Bei **Repository name** genau eingeben: `slimbitapps.github.io`
3. **Public** auswählen → **Create repository**.
4. Mir schreiben: „Startseiten-Repo ist angelegt“. → **Claude** lädt die Seite hoch.
5. Bei GitHub im neuen Repository: **Settings → Pages → Source: „Deploy from a branch“ → Branch `main`, Ordner `/ (root)` → Save**.
6. Nach 1–2 Minuten ist die Seite unter `https://slimbitapps.github.io` erreichbar.

> Warum ein eigenes Repository? Die Startseite gehört zu **allen** deinen Apps, nicht nur zum
> Fotosortierer. Jede App bekommt später ihr eigenes Repository mit eigener Download-Seite unter
> `slimbitapps.github.io/<app-name>` – die Startseite verlinkt sie alle.

### ☐ A3. Tippfehler im Repository-Namen beheben
Der Name ist `fotosortierter` (mit „t“ zu viel). Sobald Links im Internet verteilt sind, lässt sich
das kaum noch ändern – also **jetzt**.
1. Repository `fotosortierter` öffnen → **Settings** → ganz oben **Repository name**.
2. `fotosortierer` eintragen → **Rename**.
3. Mir schreiben: „umbenannt“. → **Claude** passt alle Links an (App, Download-Seite, Startseite).

Danach heißt die Download-Seite `https://slimbitapps.github.io/fotosortierer/`.

### ☐ A4. Impressum & Datenschutz ausfüllen
In Deutschland braucht eine Website, die nicht rein privat ist, ein Impressum – auch wenn alles
kostenlos ist. Du bewirbst Apps öffentlich, also solltest du eins haben.

1. Mir diese Daten geben (oder selbst in `brand-site/impressum.html` und `datenschutz.html` die
   gelb markierten Stellen ersetzen):
   - Vor- und Nachname
   - Anschrift (Straße, PLZ, Ort) – **ein Postfach reicht nicht**
   - E-Mail-Adresse aus A1
2. Du willst deine Wohnadresse nicht zeigen? Es gibt **Impressum-Dienste**, die dir eine
   ladungsfähige Adresse („c/o“) stellen. Das kostet meist ein paar Euro im Monat. Das ist der
   einzige Punkt im Plan, der eventuell Geld kostet. Ob es nötig ist, entscheidest du.

> Die Datenschutzerklärung ist schon fertig formuliert. Sie passt, weil weder die Website noch die
> App Daten sammeln: keine Cookies, kein Tracking, keine Google-Schriften.

### ☐ A5. Echter Test auf Windows und Mac (je 15 Minuten)
Am besten auf einem fremden Rechner, auf dem die App noch nie lief. Hake ab:
- ☐ Download-Seite öffnen → richtiger Knopf (Windows/Mac) wird angezeigt
- ☐ Installieren klappt mit der Anleitung auf der Seite
- ☐ Einführung erscheint beim ersten Start
- ☐ Ordner mit ca. 100 eigenen Fotos sortieren, dabei 3 Zielordner nutzen
- ☐ Rückgängig (Strg+Z / ⌘Z) holt Fotos zurück
- ☐ Serie vergleichen: Shift+Zahl, dann Zieltaste
- ☐ Einstellungen → Über die App → Link zur Website öffnet den Browser
- ☐ App schließen und neu starten → letzte Ordner sind gespeichert

Fehler? Screenshot machen und mir schicken.

### ☐ A6. Version 1.0 → Claude
Sobald A2–A5 erledigt sind, sag „Mach Version 1.0“. Ich setze die Versionsnummer und GitHub baut
automatisch die fertigen Installer.

### ☐ A7. Screenshots & Bilder → Claude
Für Store, Download-Portale und Social Media erstelle ich dir einheitliche Screenshots
(1920×1080, hell und dunkel) mit Beispielfotos. Schon fertig in `brand-site/`:
- `logo.svg` / `logo.png` – SlimBit-Apps-Logo
- `youtube-avatar.png` – Profilbild (800×800)
- `youtube-banner.png` – Kanalbanner (2560×1440, Text liegt im sicheren Bereich)

---

## Teil B – Wo die App hochgeladen wird

Übersicht – nach Wichtigkeit sortiert:

| # | Plattform | Kosten | Nutzen | Aufwand |
|---|---|---|---|---|
| B1 | Eigene Website + GitHub Releases | 0 € | Basis für alles, Updates automatisch | ✅ fertig |
| B2 | **Microsoft Store** | 0 € | Keine Windows-Warnung, Vertrauen, Store-Suche | mittel |
| B3 | winget (Windows-Paketmanager) | 0 € | Für Technik-Fans | klein |
| B4 | Download-Portale (CHIP, heise …) | 0 € | Viele Besucher aus Deutschland | klein pro Portal |
| B5 | Verzeichnisse (AlternativeTo, Product Hunt …) | 0 € | Internationale Reichweite | klein |
| B6 | Mac App Store / Homebrew | 99 $/Jahr | Erst später sinnvoll | – |

### ✅ B1. Eigene Website + GitHub Releases
Ist erledigt. Jede neue Version landet automatisch dort. **Alle anderen Plattformen verlinken auf
deine Website** – so landen Besucher immer bei dir und sehen auch deine anderen Apps.

### ☐ B2. Microsoft Store (wichtigster Schritt für Windows)
Für Einzelpersonen seit 2025 **kostenlos**. Vorteil: Keine blaue „Windows hat den PC geschützt“-
Warnung, automatische Updates, man findet dich in der Store-Suche.

1. **Konto anlegen:** `storedeveloper.microsoft.com` → „Get started“ → **Individual developer**
   (Einzelentwickler). Mit deinem Microsoft-Konto anmelden. Du brauchst einen Ausweis und machst ein
   Selfie zur Bestätigung. Keine Kreditkarte nötig.
   *Achtung:* Der „Publisher display name“ ist öffentlich → **SlimBit Apps** eintragen.
2. **Name reservieren:** Im Partner Center → **Apps und Spiele → Neues Produkt → MSIX- oder PWA-App** →
   Name `Fotosortierer` reservieren. (Ist er vergeben, z. B. `Fotosortierer – Fotos sortieren`.)
3. **Drei Werte kopieren:** Links **Produktverwaltung → Produktidentität**. Dort stehen
   `Package/Identity/Name`, `Package/Identity/Publisher` (beginnt mit `CN=`) und
   `Package/Properties/PublisherDisplayName`. → **An Claude schicken.** Ich trage sie ein, GitHub baut
   dann die Datei `Fotosortierer-Store.appx`.
4. **Einreichung ausfüllen** (Partner Center → „Einreichung starten“):
   - *Preise:* **Kostenlos**, Märkte: alle
   - *Eigenschaften:* Kategorie **Fotos & Videos**, Datenschutz-URL:
     `https://slimbitapps.github.io/datenschutz.html`, Website: `https://slimbitapps.github.io`
   - *Altersfreigabe:* Fragebogen ausfüllen (keine Gewalt, keine Käufe, kein Chat → „ab 3“)
   - *Pakete:* `Fotosortierer-Store.appx` aus dem neuesten GitHub-Release hochladen
   - *Store-Einträge:* Deutsch **und** Englisch. Beschreibung, Stichworte und Screenshots → **Claude**
     schreibt dir die Texte fertig zum Einfügen.
5. **Einreichen.** Die Prüfung dauert meist ein paar Tage. Bei Ablehnung schickt Microsoft einen
   Bericht → an Claude weitergeben.
6. **Nach der Freigabe:** Store-Link an Claude schicken → kommt als „Im Microsoft Store holen“ auf
   die Download-Seite.

> Bonus: Apps aus dem Microsoft Store lassen sich automatisch auch über den Windows-Paketmanager
> installieren (`winget install --source msstore Fotosortierer`).

### ☐ B3. winget (optional, nach B2)
Der Windows-Paketmanager (eine Art App-Store für die Kommandozeile). Technik-Leute lieben das.
1. Auf einem Windows-PC PowerShell öffnen: `winget install wingetcreate`
2. `wingetcreate new <Link zur Fotosortierer-Setup.exe aus GitHub Releases>`
3. Fragen beantworten (Publisher: `SlimBit Apps`, Name: `Fotosortierer`, Lizenz: `Freeware`).
4. Am Ende „Submit“ wählen. Ein GitHub-Token wird abgefragt; die Anleitung dazu zeigt wingetcreate an.
5. Ein Prüf-Roboter testet die App, Menschen schauen drüber. Dauert ein paar Tage.

→ Wenn dir das zu technisch ist: weglassen oder mit mir zusammen machen. Über den Store bist du in
winget sowieso schon drin.

### ☐ B4. Deutsche Download-Portale
Hier laden viele Menschen Programme. Fast überall gibt es ein Formular „Software einreichen“ /
„Programm melden“ (bei Google suchen: `<Portalname> Software einreichen`).

Reihenfolge-Empfehlung:
1. **heise Download** – seriös, gute Reichweite
2. **CHIP Download** – größtes deutsches Portal
3. **Computerbild Download**
4. **Netzwelt**

Englischsprachig:
5. **Softpedia**, **MajorGeeks**, **Uptodown**, **FileHorse**

Was du immer angeben musst:
- Name, Version, Kurz- und Langbeschreibung → **Claude** schreibt dir eine Textvorlage in Deutsch und Englisch
- **Download-Link:** immer deine Website (`slimbitapps.github.io/fotosortierer`), *nicht* direkt die .exe
- Lizenz: **Freeware**, Systeme: Windows 10/11, macOS 12+
- Screenshots (aus A7), Logo

⚠️ Nimm **keine** Angebote an, bei denen das Portal deinen Installer in einen eigenen
„Download-Manager“ verpackt oder Werbung einbaut. Das schadet deinem Ruf.

### ☐ B5. App-Verzeichnisse & Launch-Seiten (international)
- **AlternativeTo** (`alternativeto.net`): Konto anlegen → „Add application“. Den Fotosortierer als
  **Alternative** zu *Adobe Bridge*, *Photo Mechanic*, *FastRawViewer*, *XnView* und *FastStone Image
  Viewer* eintragen. Dort suchen Leute genau nach so etwas.
- **Product Hunt** (`producthunt.com`): Ein „Launch“ an einem Dienstag oder Mittwoch. Vorher Konto
  anlegen und ein paar Tage aktiv sein (kommentieren, upvoten). → **Claude** schreibt Tagline,
  Beschreibung und ersten Kommentar.
- **Hacker News** (`news.ycombinator.com`): Beitrag „Show HN: Fotosortierer – sort photos into
  folders with one key press“. Ehrlich und technisch schreiben, auf jeden Kommentar antworten.
- **SourceForge**: Kann GitHub-Releases automatisch spiegeln („Import project from GitHub“). Bringt
  zusätzliche Downloads ohne Aufwand.

### B6. Später (kostet Geld oder kommt mit Version 2)
- **Mac ohne Warnung / Mac App Store / Homebrew:** Braucht das Apple Developer Program
  (99 $/Jahr). Homebrew hat angekündigt, ab September 2026 keine Mac-Apps mehr anzubieten, die nicht von
  Apple geprüft sind. Lohnt sich erst, wenn viele Mac-Nutzer die App laden. Die Anleitung dafür steht in
  `VEROEFFENTLICHEN.md`.
- **Android:** Google Play kostet einmalig 25 $. Neue Privatkonten müssen die App vorher 14 Tage
  mit mindestens 12 Testern testen lassen. **F-Droid** wäre kostenlos, verlangt aber eine
  Open-Source-Lizenz. Entscheiden wir, wenn die Android-Version ansteht.

---

## Teil C – Werbung (alles kostenlos)

### Grundregeln
1. **Zeig das Problem, nicht die App.** „Du hast 3.000 Urlaubsfotos und keine Lust, sie zu
   sortieren?“ zieht mehr als „Hier ist meine App“.
2. **Ehrlich sein:** Immer dazusagen „Ich habe das selbst gebaut, kostenlos, ohne Werbung“. Das
   mögen die Leute und es verhindert, dass du als Spam gilst.
3. **Jeder Link geht auf deine Website**, nie direkt auf die .exe.
4. **Auf jeden Kommentar antworten** – besonders in den ersten 24 Stunden.
5. **Feedback sammeln**, eine Liste für Version 2 führen.

### ☐ C1. YouTube-Kanal einrichten
1. **Name:** SlimBit Apps · **Handle:** `@slimbitapps`
2. **Profilbild:** `brand-site/youtube-avatar.png` · **Banner:** `brand-site/youtube-banner.png`
3. **Beschreibung** (Kanal anpassen → Allgemeine Informationen):
   > Small, free apps that do one thing really well – no ads, no account, no data collection.
   > Kleine, kostenlose Apps, die eine Sache richtig gut machen.
   > 🌐 https://slimbitapps.github.io
4. **Links:** Website und Impressum (`https://slimbitapps.github.io/impressum.html`).
   Für YouTube gilt dasselbe wie für Websites: Wer Produkte bewirbt, braucht ein Impressum. Ein Link
   reicht.
5. **Kanal-Trailer:** später das Intro-Video.
6. **Einstellungen → Upload-Standards:** Beschreibung mit Website-Link vorausfüllen.

Fertige Texte für Videos und Shorts: siehe **`docs/VIDEO.md`**.

### ☐ C2. Veröffentlichungs-Rhythmus (die ersten 4 Wochen)
| Woche | YouTube | Sonstiges |
|---|---|---|
| 1 | Intro-Video (lang) + Short 1 | Startseite live, Microsoft Store einreichen |
| 2 | Short 2 + Short 3 | AlternativeTo, heise, CHIP |
| 3 | Short 4 + Short 5 | Reddit-Beiträge (C3), Foren (C4) |
| 4 | Short 6 + Tutorial „Serien vergleichen“ | Product Hunt, Hacker News |
| danach | 1 Short pro Woche | Feedback sammeln → Version 2 planen |

Jeden Short **auch** als TikTok und als Instagram-Reel hochladen. Kostet 2 Minuten und verdoppelt
die Reichweite. Vorher in DaVinci ohne YouTube-Logo/Wasserzeichen exportieren.

### ☐ C3. Reddit
Reddit ist streng mit Eigenwerbung. **Vor jedem Beitrag die Regeln der Gruppe lesen** (rechte Spalte).
Pro Gruppe nur **ein** Beitrag, nicht am selben Tag überall posten.

| Gruppe | Warum | Tipp |
|---|---|---|
| r/macapps | Explizit für Mac-App-Vorstellungen | Titel z. B. „[Free] I built a keyboard-driven photo sorter …“ |
| r/software | Allgemeine Programm-Vorstellungen | |
| r/DataHoarder | Leute mit riesigen Foto-Archiven und NAS | NAS-Sicherheit betonen |
| r/synology, r/unRAID | NAS-Besitzer | Nur wenn erlaubt, sonst im Wochen-Thread |
| r/photography, r/AskPhotography | Riesig, aber Eigenwerbung meist verboten | Nur im erlaubten Wochen-Thread |
| r/de_EDV | Deutschsprachig | Auf Deutsch schreiben |

Vorlage:
> **I built a free app to sort thousands of photos with one key press per picture**
> I always put off sorting my holiday photos, so I built a small tool: you assign a key to each
> target folder (1 = Family, 2 = Holiday …) and press it for each photo. It never overwrites
> anything, everything can be undone, it works with NAS drives, and it detects burst shots and
> suggests the sharpest one. Free, no ads, no account, works offline. Windows & Mac.
> Website: https://slimbitapps.github.io
> I'd love feedback – what's missing for your workflow?

### ☐ C4. Deutsche Foren
In Foren gibt es meist einen Bereich „Software“ oder „Programmvorstellungen“:
- **DSLR-Forum** (Bereich Software/Bildbearbeitung)
- **Fotocommunity** (Forum)
- **Synology-Forum.de** / **Unraid-Forum** (NAS-Sicherheit betonen)
- **MacUser.de**, **Mac-TechNews-Forum**
- **ComputerBase-Forum** (Bereich „Programmvorstellungen“)
- **Dr. Windows**, **Deskmodder**

Gleiche Vorlage wie bei Reddit, auf Deutsch und persönlich.

### ☐ C5. Blogs & Presse anschreiben
Kleine Tech-Blogs stellen gern kostenlose Tools vor. Kurze, freundliche Mail:
- Deutsch: *Caschys Blog*, *Deskmodder*, *Dr. Windows*, *Mac Life*, *iphone-ticker.de*, *Basic Tutorials*
- Englisch: *Ghacks*, *MakeUseOf*, *How-To Geek* (über das Kontaktformular)

Vorlage:
> Betreff: Kostenloses Tool: Fotos per Tastendruck in Ordner sortieren
>
> Hallo [Name],
> ich bin Hobby-Entwickler und habe den **Fotosortierer** gebaut – ein kostenloses Programm für
> Windows und Mac, mit dem man tausende Fotos per Tastendruck in Ordner sortiert. Es überschreibt nie
> etwas, alles ist rückgängig machbar, es funktioniert mit NAS-Laufwerken und erkennt Serienbilder.
> Kein Konto, keine Werbung, keine Datensammlung.
> Vielleicht ist das etwas für deine Leser? Screenshots und Logo findest du hier: [Link]
> 60-Sekunden-Video: [YouTube-Link]
> Viele Grüße, [Name] – SlimBit Apps · https://slimbitapps.github.io

### ☐ C6. Facebook-Gruppen
Es gibt große deutsche Gruppen zu Fotografie, Synology/NAS und Mac. Eigenwerbung ist oft nur an
bestimmten Tagen erlaubt → Regeln lesen. Das Short-Video funktioniert dort sehr gut.

---

## Teil D – Rechtliches in einfach (keine Rechtsberatung!)

| Frage | Kurze Antwort |
|---|---|
| **Brauche ich ein Gewerbe?** | Nein, solange du **kein Geld einnimmst** und es auch nicht vorhast: keine Preise, keine Werbung in der App, keine Spenden-Links. Willst du später Spenden (z. B. Ko-fi) oder Einnahmen, vorher beim Finanzamt nachfragen. Software-Entwicklung ist oft „freiberuflich“, dann reicht eine Meldung beim Finanzamt. |
| **Impressum?** | Ja, für Website und YouTube-Kanal (siehe A4). Fehlt es, drohen teure Abmahnungen. |
| **Datenschutzerklärung?** | Ja, ist fertig. Bleibt richtig, solange du **keine** Tracker, kein Google Analytics, keine Google-Fonts und keine eingebetteten YouTube-Videos einbaust. Willst du so etwas, frag mich vorher. |
| **Lizenz?** | Empfehlung: **Freeware** (kostenlos nutzbar, Code bleibt deins). Das trägst du in Stores und Portalen so ein. |
| **Name „Fotosortierer“?** | Kurz im DPMA-Register (`register.dpma.de`) nach dem Namen suchen. Ist er als Marke für Software eingetragen, lieber umbenennen, solange es noch geht. |
| **Fotos in Videos/Screenshots?** | Nur **eigene** Fotos zeigen (oder lizenzfreie, z. B. von Unsplash/Pexels). Keine erkennbaren fremden Personen ohne Einverständnis. |
| **Musik in Videos?** | Nur aus der **YouTube Audio-Mediathek** (YouTube Studio → Audio-Mediathek) oder ausdrücklich lizenzfreie Musik. |
| **KI-Stimme?** | Eine allgemeine KI-Stimme ist in Ordnung. **Keine** echte Person nachmachen (Voice-Cloning von Promis). Nutzungsbedingungen des KI-Tools lesen: Gratis-Tarife verlangen oft, dass man das Tool in der Beschreibung nennt. |

---

## Teil E – Jede weitere App (Vorlage)

Wenn App Nr. 2 kommt, läuft es genauso – nur schneller:
1. Neues GitHub-Repository `<app-name>` → **Claude** richtet automatische Builds und die Download-Seite ein
   (wie beim Fotosortierer).
2. Neue App in die Startseite eintragen (`index.html` → Liste `APPS`, einen Block kopieren).
3. In jeder App unter „Über“ der gleiche Link zur Startseite.
4. Gleiches Logo-Schema, gleiche Farben, gleicher Kanal.
5. Wieder: Store → Portale → Problem-Shorts → Reddit/Foren.

**Eine Marke, eine Website, ein Kanal, eine E-Mail** – so wächst alles zusammen, und jede neue App
profitiert von den Fans der vorherigen.

---

## Deine nächsten 3 Schritte
1. ☐ E-Mail-Adresse anlegen (A1)
2. ☐ Repository `slimbitapps.github.io` anlegen und `fotosortierter` → `fotosortierer` umbenennen (A2, A3)
3. ☐ Mir Name, Adresse und E-Mail fürs Impressum geben (A4)

Dann erledige ich: Startseite hochladen, alle Links anpassen, Version 1.0, Store-Texte, Screenshots.
