#!/bin/sh

# Regenerates the small media fixtures under fixtures/, one folder per kind,
# so that thumbnails and previews can be tried in docker-compose.dev.yml.
# doc.pdf and image.tiff stay at the root: test-document-thumbs.sh uses them.
# Needs ffmpeg, ImageMagick (magick) and 7z.

set -eu

dir="$(cd "$(dirname "$0")" && pwd)/fixtures"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

ff() {
	ffmpeg -nostdin -v error -y "$@"
}
# Strips the encoder tags and dates that change from one run to the next.
clean="-map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact"

mkdir -p "$dir/images" "$dir/videos" "$dir/audio" "$dir/archives" "$dir/texts"

# Images: one test pattern frame in each format browsers or h5ai handle.
ff -f lavfi -i testsrc2=size=640x480 -frames:v 1 "$work/frame.png"
magick "$work/frame.png" -strip "$dir/images/image.png"
magick "$work/frame.png" -strip -quality 85 "$dir/images/photo.jpg"
magick "$work/frame.png" -strip -quality 80 "$dir/images/image.webp"
magick "$work/frame.png" -strip -resize 160x120 BMP3:"$dir/images/image.bmp"
magick "$work/frame.png" -strip -resize 48x48 "$dir/images/favicon.ico"
ff -f lavfi -t 2 -i testsrc2=size=160x120:rate=5 $clean -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" "$dir/images/animation.gif"
cat >"$dir/images/drawing.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#42a5f5"/>
  <circle cx="160" cy="120" r="80" fill="#fafafa"/>
  <text x="160" y="132" font-family="sans-serif" font-size="32" text-anchor="middle" fill="#212121">h5ai</text>
</svg>
EOF

# Videos: two seconds of test pattern and tone.
src="-f lavfi -t 2 -i testsrc2=size=320x240:rate=25 -f lavfi -t 2 -i sine=frequency=440:sample_rate=44100"
ff $src $clean -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -c:a aac -b:a 48k "$dir/videos/video.mp4"
ff $src $clean -c:v libvpx-vp9 -b:v 150k -c:a libopus -b:a 32k "$dir/videos/video.webm"
ff $src $clean -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -c:a libvorbis "$dir/videos/video.mkv"
ff $src $clean -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -c:a aac -b:a 48k "$dir/videos/video.mov"
ff $src $clean -c:v mpeg4 -q:v 10 -c:a libmp3lame -b:a 48k "$dir/videos/video.avi"
ff $src $clean -c:v mpeg2video -q:v 10 -c:a mp2 -b:a 64k "$dir/videos/video.mpg"

# Audio: three seconds of tone. MP3 and M4A carry a cover, which is what
# audio thumbnails show.
magick "$work/frame.png" -resize 300x300^ -gravity center -extent 300x300 -strip "$work/cover.jpg"
tone="-f lavfi -t 3 -i sine=frequency=440:sample_rate=22050"
ff $tone -i "$work/cover.jpg" -map 0 -map 1 $clean -c:a libmp3lame -b:a 32k -c:v copy -id3v2_version 3 -disposition:v attached_pic "$dir/audio/audio.mp3"
ff $tone -i "$work/cover.jpg" -map 0 -map 1 $clean -c:a aac -b:a 32k -c:v copy -disposition:v attached_pic "$dir/audio/audio.m4a"
ff $tone $clean -c:a libvorbis -q:a 0 "$dir/audio/audio.ogg"
ff $tone $clean -ac 1 -c:a flac "$dir/audio/audio.flac"
ff -f lavfi -t 1 -i sine=frequency=440:sample_rate=8000 $clean -ac 1 -c:a pcm_s16le "$dir/audio/audio.wav"

# Archives: archive thumbnails show the first image inside.
cp "$dir/images/photo.jpg" "$work/page-1.jpg"
cp "$dir/images/image.png" "$work/page-2.png"
# A fixed date keeps the archives identical from one run to the next.
touch -d 2026-01-01T00:00:00 "$work/page-1.jpg" "$work/page-2.png"
rm -f "$dir/archives/archive.zip" "$dir/archives/comic.cbz"
(cd "$work" && 7z a -tzip -bso0 -bsp0 "$dir/archives/archive.zip" page-1.jpg page-2.png)
(cd "$work" && 7z a -tzip -bso0 -bsp0 "$dir/archives/comic.cbz" page-1.jpg page-2.png)

# Texts: one file per preview style family.
cat >"$dir/texts/notes.txt" <<'EOF'
Plain text fixture for the h5ai text preview.
Second line, with accents: é à ç ü.
EOF
cat >"$dir/texts/readme.md" <<'EOF'
# Markdown fixture

Rendered by the h5ai text preview, with a [link](https://github.com/pad92/h5ai),
`inline code` and a list:

- first item
- second item
EOF
cat >"$dir/texts/data.json" <<'EOF'
{"name": "h5ai", "fixture": true, "sizes": [1, 2, 3]}
EOF
cat >"$dir/texts/table.csv" <<'EOF'
name,type,size
photo.jpg,image,30
video.mp4,video,40
EOF
cat >"$dir/texts/config.yaml" <<'EOF'
thumbnails:
  enabled: true
  size: 240
EOF
cat >"$dir/texts/script.py" <<'EOF'
def greet(name: str) -> str:
    return f"hello {name}"


print(greet("h5ai"))
EOF
cat >"$dir/texts/style.css" <<'EOF'
body {
    color: #212121;
    background: #fafafa;
}
EOF

echo "Fixtures written to $dir"
