#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
timeline="${1:-}"
[ -n "$timeline" ] || timeline="$(ls -t "$here"/../demo-results/*/timeline.json | head -1)"
out="${2:-$here/../demo-results/understudy-demo.mp4}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

read -r main phone keep <<<"$(python3 - "$timeline" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
marks = data["marks"]
lead = 0.3
segments, cursor = [], 0.0
for start, end in zip(marks[0::2], marks[1::2]):
    cut_from = start["at"] + lead
    cut_to = max(end["at"] - lead, cut_from)
    if cut_from > cursor:
        segments.append((cursor, cut_from))
    cursor = cut_to
segments.append((cursor, None))
expr = "+".join(f"between(t,{a:.2f},{b:.2f})" if b is not None else f"gte(t,{a:.2f})" for a, b in segments)
print(data["mainVideo"], data["phoneVideo"], expr)
PY
)"

ffmpeg -loglevel error -y -i "$main" -vf "select='${keep}',setpts=N/FRAME_RATE/TB,fps=30,format=yuv420p" -an -c:v libx264 -preset slow -crf 24 "$work/main.mp4"
if [ "$phone" = "None" ]; then
  ffmpeg -loglevel error -y -i "$work/main.mp4" -c copy -movflags +faststart "$out"
else
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0x101318:s=1280x800:r=30" -i "$phone" \
    -filter_complex "[1:v]fps=30,scale=-2:760[p];[0:v][p]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p" \
    -an -c:v libx264 -preset slow -crf 24 "$work/phone.mp4"
  printf "file '%s'\nfile '%s'\n" "$work/main.mp4" "$work/phone.mp4" > "$work/list.txt"
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$work/list.txt" -c copy -movflags +faststart "$out"
fi
python3 - "$out" <<'PY'
import os, subprocess, sys
path = sys.argv[1]
seconds = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]).decode().strip())
print(f"{path} {seconds:.1f}s {os.path.getsize(path) / 1e6:.1f} MB")
PY
