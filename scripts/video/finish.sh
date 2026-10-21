#!/bin/bash
# Letzter Schritt: Deckblatt (0,5 s Thumbnail) vorne, eigene Hintergrundmusik darunter (music.py, wird leiser,
# sobald gesprochen wird) + Lautheit in zwei Durchgängen normalisieren.
#   bash scripts/video/finish.sh MASTER.mp4 THUMBNAIL.jpg FINAL.mp4 LUFS(-14 Shorts, -15 Intro) [MUSIK=pop|lofi|epic|none] [SEED=1]
#   Ohne Stimme (nur Effekte): NODUCK=1 – sonst „pumpt“ die Musik bei jedem Klick.
set -e
M=$1; IMG=$2; OUT=$3; L=${4:--14}; MUS=${5:-none}; SEED=${6:-1}
TMP="${OUT%.mp4}-cover.mov"
bash "$(dirname "$0")/add-cover.sh" "$M" "$IMG" "$TMP" 0.5 >/dev/null
if [ "$MUS" != "none" ]; then
  D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP")
  python3 "$(dirname "$0")/music.py" "$MUS" "$D" "${OUT%.mp4}-music.wav" --seed "$SEED" >/dev/null
  # Musik ca. 8 % Lautstärke (geprüft: Stimme bleibt verständlich), zusätzlich Ducking über die Stimme (+ Effekte); NODUCK=1 → ohne Ducking
  if [ -n "$NODUCK" ]; then
    F="[0:a]aformat=channel_layouts=stereo[v];[1:a]volume=${MUSIC_VOL:-0.08}[md];[v][md]amix=inputs=2:normalize=0:duration=first[a]"
  else
    F="[0:a]aformat=channel_layouts=stereo,asplit[v][k];[1:a]volume=${MUSIC_VOL:-0.08}[m];[m][k]sidechaincompress=threshold=0.03:ratio=4:attack=30:release=400[md];[v][md]amix=inputs=2:normalize=0:duration=first[a]"
  fi
  ffmpeg -v error -y -i "$TMP" -i "${OUT%.mp4}-music.wav" -filter_complex "$F" \
    -map 0:v -map "[a]" -c:v copy -c:a pcm_s16le "${OUT%.mp4}-mix.mov"
  mv "${OUT%.mp4}-mix.mov" "$TMP"; rm -f "${OUT%.mp4}-music.wav"
fi
J=$(ffmpeg -nostats -i "$TMP" -af "loudnorm=I=$L:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
A=$(python3 -c "import json,sys;d=json.loads(sys.argv[1]);print(f\"measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}:linear=true\")" "$J")
ffmpeg -v error -y -i "$TMP" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -af "loudnorm=I=${L}:TP=-1.5:LRA=11:${A}" -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$OUT"
rm -f "$TMP"
echo "fertig: $OUT ($(ffmpeg -nostats -i "$OUT" -af ebur128 -f null - 2>&1 | grep -E '^\s+I:' | tail -1 | tr -s ' '))"
