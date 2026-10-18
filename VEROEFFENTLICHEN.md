# Veröffentlichen – Schritt für Schritt

Ziel: Nutzer laden **eine Datei** herunter, doppelklicken – fertig. Ohne Warnmeldungen.

Damit Windows und macOS ein Programm ohne Warnung öffnen, muss es **digital signiert** sein.
Das ist der einzige Teil, den die Technik nicht allein lösen kann – du brauchst dafür Konten.

| | Kosten | Ergebnis |
|---|---|---|
| **Windows: Microsoft Store** | kostenlos (Einzelentwickler) | Installieren per Klick im Store, keine Warnung, automatische Updates. Microsoft signiert die App. |
| **Mac: Apple Developer Program** | 99 USD pro Jahr | `.dmg` öffnet ohne Warnung (signiert + von Apple geprüft, „notarisiert“). |
| Ohne beides | kostenlos | Funktioniert auch – aber Nutzer sehen beim ersten Öffnen eine Warnung. Die Download-Seite erklärt dann, wie man sie wegklickt. |

---

## 1. GitHub (kostenlos, einmalig)

Hier liegt der Code, hier werden die Installer automatisch gebaut, hier liegt die Download-Seite.

1. Konto auf github.com anlegen, neues Repository `slimsort` erstellen.
2. Code hochladen (das kann Claude für dich machen).
3. **Settings → Pages → Source: „GitHub Actions“** einstellen.
   → Die Download-Seite ist dann unter `https://slimbitapps.github.io/slimsort` erreichbar.
4. In `website/index.html` ganz unten `REPO = 'slimbitapps/slimsort'` eintragen.
5. Neue Version veröffentlichen: Tag `v0.1.0` anlegen (Releases → „Draft a new release“ → Tag `v0.1.0` → Publish).
   GitHub baut dann `SlimSort-Setup.exe` und `SlimSort-Mac.dmg` und hängt sie an.
   Die Download-Seite zeigt automatisch immer auf die neueste Version.

## 2. Mac ohne Warnung (Apple, 99 USD/Jahr)

1. Auf developer.apple.com/programs dem **Apple Developer Program** beitreten (Apple-ID nötig).
2. In Xcode oder im Apple-Developer-Portal ein Zertifikat **„Developer ID Application“** erstellen
   und als `.p12`-Datei mit Passwort exportieren.
3. Auf appleid.apple.com ein **app-spezifisches Passwort** erstellen.
4. Bei GitHub unter **Settings → Secrets and variables → Actions** eintragen:
   - `MAC_CERT_P12_BASE64` – die `.p12`-Datei als Base64 (Terminal: `base64 -i zertifikat.p12 | pbcopy`)
   - `MAC_CERT_PASSWORD` – Passwort der `.p12`
   - `APPLE_ID` – deine Apple-ID (E-Mail)
   - `APPLE_APP_SPECIFIC_PASSWORD` – das app-spezifische Passwort
   - `APPLE_TEAM_ID` – 10-stellige Team-ID (steht im Developer-Portal unter „Membership“)
5. In `website/index.html` `MAC_SIGNED = true` setzen → der Warnhinweis verschwindet von der Seite.

Ab dann ist jede neue Mac-Version automatisch signiert und notarisiert.

## 3. Windows ohne Warnung (Microsoft Store, kostenlos)

1. Auf storedeveloper.microsoft.com als **Einzelentwickler** registrieren.
2. Im Partner Center **neue App** anlegen, Namen „SlimSort“ reservieren.
3. Unter **Produktidentität** stehen drei Werte. Diese in `package.json` im Abschnitt `"appx"` eintragen:
   `identityName`, `publisher` (beginnt mit `CN=`), `publisherDisplayName`.
4. GitHub baut dann zusätzlich `SlimSort-Store.appx` – diese Datei im Partner Center hochladen.
5. Nach der Prüfung durch Microsoft: Store-Link in `website/index.html` bei `STORE_URL` eintragen
   und `WIN_SIGNED = true` setzen.

Der direkte Download (`SlimSort-Setup.exe`) bleibt zusätzlich bestehen. Ohne eigenes
Zertifikat zeigt Windows dort weiterhin „Weitere Informationen → Trotzdem ausführen“.
Wer das auch wegbekommen will, braucht ein Code-Signing-Zertifikat und trägt es als
`WIN_CERT_P12_BASE64` / `WIN_CERT_PASSWORD` bei GitHub ein.

---

## Was Nutzer dann erleben

**Windows (Store):** Store-Link → „Installieren“ → fertig.
**Windows (Download):** `SlimSort-Setup.exe` doppelklicken → installiert sich ohne Fragen, startet sofort,
Symbol auf dem Desktop und im Startmenü.
**Mac:** `.dmg` öffnen → ein Fenster mit Pfeil zeigt „Symbol auf Programme ziehen“ → aus Programme starten.
