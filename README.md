# Fotosortierer

Fotos und Videos blitzschnell per Tastendruck in Ordner sortieren – für Windows und Mac (Android folgt).

**Alles bleibt lokal.** Keine Datensammlung, kein Internet nötig.

---

## Installieren

**Am einfachsten über die Download-Seite** (Ordner `website/`): Sie erkennt dein System,
zeigt einen Download-Knopf und erklärt die Installation mit Bildern.

- **Windows:** `Fotosortierer-Setup.exe` doppelklicken. Es installiert sich ohne Fragen und startet sofort.
- **Mac:** `Fotosortierer-Mac.dmg` öffnen und das Symbol auf „Programme“ ziehen. Ein Pfeil im Fenster zeigt, wohin.

Wie die App ohne Warnmeldungen von Windows/macOS veröffentlicht wird: siehe **[VEROEFFENTLICHEN.md](VEROEFFENTLICHEN.md)**.

---

## So funktioniert’s

1. **Quellordner wählen** (oder hineinziehen).
2. **Zielordner anlegen** (unten „+ Zielordner hinzufügen“). Jeder bekommt automatisch eine Taste (1, 2, 3 …).
3. **Taste drücken** → die Datei wandert in den Ordner, die nächste erscheint.

| Taste | Wirkung |
|---|---|
| Zielordner-Taste | Datei (oder alle markierten) in diesen Ordner |
| Leertaste | Überspringen |
| Entf / ⌫ | In den Löschordner („_Gelöscht“) |
| Enter | Nur diese Datei in einen anderen Ordner |
| Strg/⌘ + Z | Rückgängig – beliebig oft |
| Tab | Raster ↔ Einzelbild |
| F11 | Vollbild · **Esc** beendet es immer |
| F10 | Nur Bild (alles ausblenden) |
| F1 | Tastenübersicht |

Rechtsklick auf ein Ziel: Taste, Name, Farbe oder Ordner ändern. Ziel auf ein anderes ziehen = Gruppe.

**Simpel / Expert** (oben rechts): Simpel zeigt nur das Nötigste. Expert zeigt zusätzlich Filter,
Reihenfolge, Kopieren statt Verschieben, Profile und Feineinstellungen.

---

## Sicherheit – so werden deine Fotos geschützt

- Es wird **nie etwas überschrieben**. Gibt es den Namen schon, heißt die neue Datei „Name (2).jpg“.
- Auf ein anderes Laufwerk / NAS wird **erst kopiert, dann geprüft (Prüfsumme), dann erst das Original entfernt**.
- Das **Änderungsdatum bleibt erhalten**.
- Ist ein Zielordner nicht erreichbar (z. B. NAS aus), kommt eine klare Meldung – **die Datei bleibt, wo sie ist**.
- Die App merkt selbst, wenn ein Ordner wieder erreichbar ist (nach dem Start mehrfach geprüft).
- Begleitdateien (`.xmp`, `.aae`, `.thm`) und Live-Photo-Videos wandern automatisch mit.
- „Löschen“ verschiebt nur in einen Löschordner. Endgültig weg ist erst, was du dort ausdrücklich leerst.
- Jede Dateibewegung steht im lokalen **Protokoll** (Einstellungen → Erweitert).

---

## Stand der Entwicklung

**Version 0.1 (erste nutzbare Version)** – enthalten:
Raster- und Einzelansicht, Zoom/Verschieben, Videos, Bildleiste, Vollbild, Nur-Bild-Modus,
Zielleiste mit Tasten/Farben/Zählern/Gruppen, Löschordner, Überspringen, „Anderer Ordner …“,
Verschieben/Kopieren, unbegrenztes Rückgängig, Filter & Reihenfolge, Profile, Schnellstart-Kacheln,
Live Photos, Zielvorschlag, Fortschritt mit Restzeit, Bilanz, NAS-Überwachung,
„Verlorene Ordner suchen“, Hell/Dunkel, Deutsch/Englisch, Hilfe-„?“.

**Als Nächstes:** Serien erkennen & vergleichen (mit Bewertung von Schärfe/Belichtung), danach Android.

---

## Für Entwickler

Technik: Electron (Fenster + Dateizugriff), React + TypeScript (Oberfläche), Vite (Bauen).

```bash
npm install
npm start            # App bauen und starten
npm test             # Sicherheitstests (Verschieben, Rückgängig, NAS …)
npm run test:e2e     # echte App automatisch durchklicken (braucht Playwright)
npm run dist:win     # Windows-Installer (auf Windows)
npm run dist:mac     # Mac-DMG (auf einem Mac)
```

Aufbau:
- `electron/core/` – Dateilogik ohne Oberfläche (sicheres Verschieben, Warteschlange, Rückgängig, NAS-Prüfung)
- `electron/main.cjs` – Fenster, Vorschaubilder, Verbindung zur Oberfläche
- `src/` – Oberfläche (React); Texte aller Sprachen in `src/i18n.ts`
- `test/` – automatische Tests

Installer werden per GitHub Actions automatisch gebaut (`.github/workflows/build.yml`).
