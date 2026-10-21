#!/bin/bash
# Setzt das Thumbnail als Deckblatt für eine halbe Sekunde vor das Video.
# Grund: Eigene Thumbnails darf das YouTube-Konto (noch) nicht hochladen – so lässt sich
# das Deckblatt beim Hochladen als Titelbild auswählen (Shorts: „Cover“ → ganz an den Anfang).
#   bash scripts/video/add-cover.sh VIDEO.mp4 THUMBNAIL.jpg AUSGABE.mov [SEKUNDEN=0.5]   (verlustarm, danach finish.sh)
set -e
V=$1; IMG=$2; OUT=$3; SEC=${4:-0.5}
IFS=x read W H < <(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0:s=x "$V")
ffmpeg -v error -y -loop 1 -framerate 30 -t "$SEC" -i "$IMG" -f lavfi -t "$SEC" -i anullsrc=r=48000:cl=mono -i "$V" -filter_complex \
  "[0:v]scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,setsar=1,format=yuv420p,fps=30[c];[2:v]setsar=1,format=yuv420p,fps=30[v];[2:a]aformat=sample_rates=48000:channel_layouts=mono[a];[c][1:a][v][a]concat=n=2:v=1:a=1[ov][oa]" \
  -map "[ov]" -map "[oa]" -c:v libx264 -preset slow -crf ${CRF:-16} -pix_fmt yuv420p -c:a pcm_s16le -ar 48000 "$OUT"
echo "Deckblatt ($SEC s) → $OUT"
