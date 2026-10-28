# Capri auf Arch / CachyOS mit KDE Plasma 6

Diese Portierung basiert auf dem unveränderten Upstream-Commit
[`f7685d2`](https://github.com/mochiiwuff/capri-desktop/commit/f7685d2295ed21b238537a258934cb8fc3e72f49).
Der ursprüngliche Commit und sein Quellbaum wurden per Git-SHA überprüft; die
lokale Historie ist zunächst flach und wird beim Abschluss vervollständigt.

## Auf diesem Rechner abschließen

Im normalen Desktop-Terminal ausführen:

```bash
bash /run/media/elia/S/capri-desktop/scripts/finish-setup.sh
```

Das Skript benutzt die bereits angemeldete GitHub-CLI, erstellt den Fork, lädt
den Branch `arch-linux` hoch, führt die vollständigen Tests aus, installiert einen
Eintrag im Anwendungsmenü und die Hooks für den vorhandenen Coding-Assistenten
(Codex bevorzugt, sonst Claude Code) und startet Capri. Bestehende fremde Hooks
bleiben erhalten; die Upstream-Installer schreiben Sicherungskopien.
Ein vorhandenes fremdes Repository oder ein abweichendes `origin` wird nicht
überschrieben. Kein Autostart wird ungefragt aktiviert.

Danach den Coding-Assistenten neu starten. Autostart kann im Capri-Menü über
**Start at login** eingeschaltet werden. Rechtsklick auf Capri oder ihr Tray-Symbol
öffnet das Menü. `Strg+Alt+C` legt sie weg oder holt sie zurück.

Die Logs liegen in `.runtime/setup.log` und `.runtime/capri.log`.

## Claude Code zusätzlich verbinden

Im normalen Desktop-Terminal:

```bash
node /run/media/elia/S/capri-desktop/scripts/connect-claude-linux.js
```

Das Skript prüft Claude Code und die Integrationstests, installiert die
[Claude-Code-Hooks](https://code.claude.com/docs/en/hooks) mit Sicherung der
vorhandenen Einstellungen und startet Capri mit Claude Code als beobachtetem
Assistenten neu. Danach eine neue Claude-Code-Sitzung starten. Bei deren erster
Aktivität bestätigt Capri die Verbindung.

Groq bleibt als Chat-Anbieter erhalten. Vorhandene Codex-Hooks bleiben installiert;
im Capri-Menü kann zwischen den beobachteten Assistenten gewechselt werden.
Capri beobachtet jeweils den ausgewählten Assistenten.

## Abgeschnittene Chatantworten

Die Streaming-Anbindung verarbeitet auch die letzte Datenzeile ohne abschließenden
Zeilenumbruch und erkennt Verbindungsabbrüche. Meldet ein kompatibler Chat-Anbieter
ausdrücklich ein Tokenlimit, wird die Antwort höchstens zweimal fortgesetzt.
Groq erhält ein Ausgabelimit von 4096 Tokens pro Teilantwort. Bei Fehlern bleibt
der empfangene Text mit einem Fehlerhinweis sichtbar. Im Laufzeitlog stehen nur
Abschlussgrund und Zeichenanzahl, keine Antworttexte oder Zugangsdaten.
Der Gesprächskontext beginnt auch nach mehr als zehn Austauschen mit einer
Nutzerfrage. Leere Modellantworten werden nicht als Gesprächserinnerungen
gespeichert; ältere reine Platzhalter werden aus dem Anfragekontext ausgelassen.
HTTP 429 wird als Rate-Limit behandelt und löst keine sofortige automatische
Wiederholung oder Modellwechsel aus. Die ursprüngliche Provider-Meldung bleibt
sichtbar.

Für die auf diesem Rechner beobachteten Qwen-Antwortfragmente:

```bash
node /run/media/elia/S/capri-desktop/scripts/repair-groq-linux.js
```

Das Skript prüft zunächst eine vollständige Antwort von `openai/gpt-oss-120b`
über den vorhandenen Groq-Zugang. Bei erfolgreicher Prüfung wird Capri gestoppt,
der alte Chatverlauf neben `memory.json` archiviert und ein neues Gespräch mit dem
geprüften Modell begonnen. Konfiguration und Verlauf werden vorher gesichert;
persönliche Erinnerungen, Bond und Claude-Code-Anbindung bleiben erhalten.
Die Prüfmetadaten stehen in `.runtime/groq-repair.json`.

## Änderungen

| Funktion | Linux-Anbindung |
| --- | --- |
| Auf Fenstern sitzen, mitfahren, fallen, Fenster-Effekte | Temporäres KWin-6-Skript für native Wayland- und X11-Fenster, inklusive Stapelreihenfolge, Arbeitsflächen und Aktivitäten |
| Aktives Fenster, Antworten bei Fokuswechsel, andere AIs erkennen | KWin meldet IDs und AI-Namensübereinstimmungen; Fenstertitel und Inhalte werden nicht übertragen |
| Transparenz und Mausinteraktion | Electron läuft unter XWayland; eine X11-Eingabeform umfasst nur Figur und Bedienelemente, die übrige Desktopfläche bleibt durchlässig |
| Chat- und API-Key-Eingaben | Von Anfang an fokussierbares Linux-Fenster; nativer Fenster- und Web-Inhalt-Fokus beim Öffnen und erneuten Anklicken eines Eingabefelds |
| Über Vollbildfenstern und ohne Taskleisteneintrag | Fenstereigene KDE-Overlay-Rolle vor dem ersten Anzeigen; KWin setzt zusätzlich `skipTaskbar`, `skipPager` und `skipSwitcher` |
| Mehrere Bildschirme | Vorhandene Electron-Bildschirmsteuerung, KWin-Koordinaten und globaler Mauszeiger |
| Anwendungen öffnen | Gio-Anwendungskatalog und `gtk-launch`, einschließlich registrierter Flatpak-Programme |
| Anwendungen schließen | KWin sendet normales Schließen an die ausdrücklich ausgewählten Fenster; erzwungenes Beenden bleibt hinter der vorhandenen Bestätigung |
| Spiele starten | Steam-Bibliotheken einschließlich Flatpak; Epic-Manifeste von Heroic und Start über dessen URI |
| Musik und Lautstärke | MPRIS über den Desktop-Bus; PipeWire/WirePlumber über `wpctl` |
| Start bei Anmeldung | Benutzerbezogene XDG-Autostart-Datei |
| Ollama-Start mit Coding-Assistent | Eigener Konsole-Aufruf anstelle von `cmd.exe` |
| Missionsbericht kopieren | Kompatibilität mit der Zwischenablage von Electron 42 |
| Animationen, Sprache, Sound, Chat, Erinnerungen, Bond, Hooks | Vorhandener Upstream-Code bleibt in Verwendung |

Das KWin-Skript wird beim Start temporär geladen und beim Beenden entladen.
Es verändert keine KWin-Regeln und installiert kein dauerhaft aktives Plugin.
Für die Darstellung über aktiven Vollbildfenstern setzt Capri an ihrem eigenen
XWayland-Fenster den KDE-Typ `CriticalNotification`. KWin ordnet diese Ebene über
dem aktiven Vollbildfenster ein; gewöhnliches `keepAbove` liegt darunter.
Die Eingabefähigkeit bleibt erhalten. Diese Eigenschaften verschwinden beim
Schließen des Fensters und betreffen keine anderen Programme.
Die Eingabeform wird regelmäßig erneuert und bei ausbleibenden Aktualisierungen
nach einer halben Sekunde geleert. Auch beim Ziehen wird kein bildschirmweiter
Eingabebereich eingeschaltet. KWin-Fensterkanten und Mauszeiger werden relativ zur
tatsächlichen Overlay-Geometrie berechnet, einschließlich Bildschirmwechsel und
unterschiedlicher Skalierung.
Die Anbindung nutzt die [offizielle KWin-Scripting-API](https://develop.kde.org/docs/plasma/kwin/api/).
Für X11 ohne KDE gibt es eine EWMH-Anbindung über Python-Xlib. Andere
Wayland-Compositoren sind mit dieser Portierung nicht unterstützt.

Chat benötigt einen vorhandenen Ollama-Server samt Modell oder einen der bereits
unterstützten API-Anbieter samt Zugang. Ein lokaler Ollama-Befehl ist auf diesem
Rechner vorhanden; Erreichbarkeit und Modelle konnten in der eingeschränkten
Coding-Sitzung nicht geprüft werden. Es wurden keine Modelle heruntergeladen.
Heroic muss für Epic-Starts installiert und als URI-Handler registriert sein.

## Voraussetzungen und Befehle

Auf diesem Rechner sind Node.js, Electron 42, Python, python-dbus,
python-gobject, python-xlib, qt6-tools, gtk3 und WirePlumber vorhanden.
Bei einer Neuinstallation auf Arch:

```bash
sudo pacman -S --needed nodejs npm electron42 python python-dbus python-gobject python-xlib qt6-tools gtk3 wireplumber
npm install --ignore-scripts
npm start
```

Der Linux-Starter verwendet den installierten Electron und verhindert den
`isPackaged`-Override des Arch-Wrappers im Quellbetrieb. Mit `CAPRI_ELECTRON`
kann ein anderer kompatibler Electron-Pfad gewählt werden. Der Chromium-Sandbox
wird kein Abschaltflag übergeben.

```bash
npm run dev:linux       # Debug-Brücke und Entwicklungsmenü
npm run check:linux     # Voraussetzungen und KWin-Zugriff prüfen
npm test               # Alle Tests einschließlich lokaler HTTP-Integration
npm run dist:linux     # Linux-Verzeichnis mit dem vorhandenen Electron 42 bauen
node scripts/install-linux.js --uninstall  # Menüeintrag und Autostart entfernen
```

Das gebaute Programm liegt unter `dist/linux-unpacked/capri`.
Der Haupt-Electron-Prozess, Node-Installation und lokale Quellen müssen mit dem
Benutzerkonto laufen; kein `sudo` für Start oder Einrichtung.

## Prüfstand dieser Portierung

Die KWin-Vertragsprüfungen (simulierte API), der echte Gio-Anwendungskatalog,
Desktop-Dateien einschließlich Sonderzeichen und die netzwerkfreien Hook-Tests
wurden lokal geprüft. Ein Linux-Paket wurde aus dem System-Electron gebaut.

Die vollständigen 14 ursprünglichen Portierungs- und Hook-Tests wurden danach in
der normalen Desktop-Sitzung ausgeführt und bestanden. Die laufende KWin-Brücke
meldete 13 erkannte Fenster; Anklicken und Bedienung wurden vom Benutzer bestätigt.
Für die spätere Korrektur der Tastatureingabe gibt es zusätzliche Regressionstests.
Die Coding-Sandbox selbst verweigert Desktop-D-Bus, lokale Listen-Sockets und den
grafischen Electron-Start. Ein Neustart mit abschließendem Verbindungscheck ist
deshalb über `bash scripts/update-linux.sh` im normalen Terminal möglich. Die
Eingabe muss nach dem Update noch im echten Desktop geprüft werden; eigene
API-Zugangsdaten werden für diese Prüfungen nicht gelesen oder ausgegeben.

Die Lizenz und Rechte an Figurenbildern bleiben unverändert; siehe [README](README.md)
und [LICENSE](LICENSE).
