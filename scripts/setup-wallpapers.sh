#!/usr/bin/env bash
#
# GNOME Beautifier — wallpaper library installer
#
# One-shot, idempotent. Populates ~/Pictures/Weather-Wallpapers/<bucket>/
# (and optionally <bucket>/<time-of-day>/) from the actual KDE / Plasma
# wallpaper packages PLUS GNOME backgrounds.
#
# Sources scanned (in this order):
#   /usr/share/wallpapers/<Name>/contents/images/<WxH>.<ext>   ← KDE packs
#   /usr/share/wallpapers/<Name>/contents/images_dark/...      ← KDE dark variants
#   /usr/share/plasma/wallpapers/                              ← Plasma extras
#   /usr/share/backgrounds/                                    ← GNOME backgrounds
#
# For each KDE wallpaper directory we pick the HIGHEST-RESOLUTION image
# under contents/images/ (parsed from the WxH filename). One representative
# image per wallpaper package, so we don't fill the bucket with 6 different
# resolutions of the same image.
#
# Distribution: every bucket gets EVERY image (cheap with hard links when
# supported, otherwise full copies). This way:
#   - Each bucket always has many candidates to cycle through.
#   - "Next wallpaper" actually changes the image.
#   - Users can later curate per-bucket folders by deleting images that
#     don't match (e.g. remove non-rainy images from rain/).
#
# Time-of-day subfolders (morning/afternoon/evening/night) are created
# empty so the extension's <bucket>/<time>/ probe finds them; users opt
# in by populating them.
#
# Usage:   bash scripts/setup-wallpapers.sh
#          bash scripts/setup-wallpapers.sh --no-install
#          bash scripts/setup-wallpapers.sh --root /custom/path
#          bash scripts/setup-wallpapers.sh --copy        # full copies, not hardlinks
#          bash scripts/setup-wallpapers.sh --semantic    # try name-based bucket matching first
#
# Env:     GNOMEBEAUTIFIER_WALLPAPER_ROOT (same as --root)

set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
LOG="$HOME/gnomebeautifier-setup-${TS}.log"

WALL_ROOT="${GNOMEBEAUTIFIER_WALLPAPER_ROOT:-$HOME/Pictures/Weather-Wallpapers}"
DO_INSTALL=1
USE_COPY=0
USE_SEMANTIC=0
STAGING="$HOME/.cache/gnomebeautifier/staging-wallpapers"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-install) DO_INSTALL=0; shift ;;
        --root)       WALL_ROOT="$2"; shift 2 ;;
        --copy)       USE_COPY=1; shift ;;
        --semantic)   USE_SEMANTIC=1; shift ;;
        -h|--help)    sed -n '1,40p' "$0"; exit 0 ;;
        *)            echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

WEATHER_BUCKETS=(clear clouds rain storm snow fog night default)
TIME_BUCKETS=(morning afternoon evening night)

# Naïve name → bucket hints for --semantic mode. KDE wallpaper names rarely
# correlate with weather, but a few do (Rain, Storm, Snow themed art).
declare -A SEMANTIC_PATTERNS=(
    [clear]='sun|sunny|bright|day|noon|clear|sky|blue'
    [clouds]='cloud|overcast|sky|misty'
    [rain]='rain|drip|drop|water|puddle|wet'
    [storm]='storm|thunder|lightning|tempest'
    [snow]='snow|winter|ice|frost|frozen|arctic|cold'
    [fog]='fog|mist|haze'
    [night]='night|moon|stars|dark|midnight|nocturnal'
)

log()  { echo "$@" | tee -a "$LOG"; }
step() { echo; log "===== $* ====="; }

step "GnomeBeautifier wallpaper setup (v2)"
log "Root:       $WALL_ROOT"
log "Staging:    $STAGING"
log "Log file:   $LOG"
log "Install:    $DO_INSTALL"
log "Mode:       $([[ $USE_COPY -eq 1 ]] && echo 'copy' || echo 'hardlink (falls back to copy)')"
log "Semantic:   $USE_SEMANTIC"

if [[ $DO_INSTALL -eq 1 ]]; then
    step "Install KDE/Plasma + GNOME wallpaper packages (sudo)"
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
            plasma-workspace-wallpapers \
            kde-wallpapers \
            kdeplasma-addons-data \
            gnome-backgrounds \
            curl jq python3 || true
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y plasma-workspace-wallpapers gnome-backgrounds curl jq python3 || true
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --needed --noconfirm plasma-workspace-wallpapers gnome-backgrounds curl jq python || true
    else
        log "WARNING: unknown package manager; skipping install step."
    fi
fi

# ---------------------------------------------------------------------------
# Stage: pick the HIGHEST-RESOLUTION image per KDE wallpaper package, plus
# anything found loose in /usr/share/backgrounds or /usr/share/plasma/wallpapers.
# ---------------------------------------------------------------------------

step "Stage source images into $STAGING"
rm -rf "$STAGING"
mkdir -p "$STAGING"

# --- 1. KDE wallpaper packages under /usr/share/wallpapers/<Name>/
if [[ -d /usr/share/wallpapers ]]; then
    log "Scanning KDE wallpaper packages under /usr/share/wallpapers/ ..."
    for wpdir in /usr/share/wallpapers/*/; do
        [[ -d "$wpdir" ]] || continue
        name="$(basename "$wpdir")"
        # Each KDE wallpaper has its largest images under contents/images/
        # with filenames like 1920x1200.jpg, 5120x2880.jpg. Pick the one
        # with the largest WxH product.
        best=""
        best_area=0
        while IFS= read -r -d '' img; do
            base="$(basename "$img")"
            # Parse WxH from the filename
            if [[ "$base" =~ ^([0-9]+)x([0-9]+)\. ]]; then
                area=$(( ${BASH_REMATCH[1]} * ${BASH_REMATCH[2]} ))
                if (( area > best_area )); then
                    best_area=$area
                    best="$img"
                fi
            fi
        done < <(find "$wpdir" -path '*/contents/images/*' -type f \
                    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -print0 2>/dev/null)

        # If no WxH-named image, fall back to any image in contents/images/
        if [[ -z "$best" ]]; then
            best="$(find "$wpdir" -path '*/contents/images/*' -type f \
                       \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) \
                       2>/dev/null | head -1)"
        fi

        # If contents/images/ doesn't exist (older KDE layout), scan whole pkg
        if [[ -z "$best" ]]; then
            best="$(find "$wpdir" -type f \
                       \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) \
                       2>/dev/null | head -1)"
        fi

        if [[ -n "$best" ]]; then
            ext="${best##*.}"
            safe="$(echo "$name" | tr -cd '[:alnum:]._-')"
            cp -n "$best" "$STAGING/kde-${safe}.${ext}" 2>/dev/null || true
        fi
    done
fi

# --- 2. Loose images from /usr/share/backgrounds (GNOME / system)
if [[ -d /usr/share/backgrounds ]]; then
    log "Scanning /usr/share/backgrounds/ ..."
    while IFS= read -r -d '' img; do
        safe="$(basename "$img" | tr ' ' '_' | tr -cd '[:alnum:]_.-')"
        cp -n "$img" "$STAGING/sys-${safe}" 2>/dev/null || true
    done < <(find /usr/share/backgrounds -type f \
                 \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -print0)
fi

# --- 3. /usr/share/plasma/wallpapers (Plasma extras, not part of /usr/share/wallpapers)
if [[ -d /usr/share/plasma/wallpapers ]]; then
    log "Scanning /usr/share/plasma/wallpapers/ ..."
    while IFS= read -r -d '' img; do
        safe="$(basename "$img" | tr ' ' '_' | tr -cd '[:alnum:]_.-')"
        cp -n "$img" "$STAGING/plasma-${safe}" 2>/dev/null || true
    done < <(find /usr/share/plasma/wallpapers -type f \
                 \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -print0)
fi

COUNT="$(find "$STAGING" -maxdepth 1 -type f | wc -l)"
log "Staged $COUNT images from system packages."
if [[ "$COUNT" -lt 1 ]]; then
    log "ERROR: no wallpapers found. Install the relevant packages (plasma-workspace-wallpapers, kde-wallpapers, gnome-backgrounds) and rerun."
    exit 1
fi

# ---------------------------------------------------------------------------
# Create bucket folders + time-of-day subfolders.
# ---------------------------------------------------------------------------

step "Create bucket layout under $WALL_ROOT"
mkdir -p "$WALL_ROOT"
for b in "${WEATHER_BUCKETS[@]}"; do
    mkdir -p "$WALL_ROOT/$b"
    for t in "${TIME_BUCKETS[@]}"; do
        mkdir -p "$WALL_ROOT/$b/$t"
    done
done

# ---------------------------------------------------------------------------
# Distribute: every bucket gets every staged image (linked when possible).
# This guarantees Next/Previous always has something to advance to.
# Semantic mode (--semantic) ALSO drops name-matched images into the
# matching bucket's top level for the lucky few that match keywords.
# ---------------------------------------------------------------------------

step "Distribute images across buckets"

link_or_copy() {
    local src="$1" dst="$2"
    if [[ $USE_COPY -eq 1 ]]; then
        cp -f "$src" "$dst"
    else
        # ln -f returns nonzero across filesystems; fall back to cp.
        ln -f "$src" "$dst" 2>/dev/null || cp -f "$src" "$dst"
    fi
}

mapfile -t IMAGES < <(find "$STAGING" -maxdepth 1 -type f \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) | sort)

for img in "${IMAGES[@]}"; do
    base="$(basename "$img")"

    # Drop a copy in every bucket so each has plenty to cycle through.
    for b in "${WEATHER_BUCKETS[@]}"; do
        link_or_copy "$img" "$WALL_ROOT/$b/$base"
    done
done

# Semantic mode: clear existing semantic-named matches and re-mark images
# whose source filename hints at a bucket.
if [[ $USE_SEMANTIC -eq 1 ]]; then
    step "Semantic name matching"
    for img in "${IMAGES[@]}"; do
        lower="$(basename "$img" | tr 'A-Z' 'a-z')"
        for bucket in "${!SEMANTIC_PATTERNS[@]}"; do
            pattern="${SEMANTIC_PATTERNS[$bucket]}"
            if [[ "$lower" =~ ($pattern) ]]; then
                log "  $lower → $bucket (matched ${BASH_REMATCH[1]})"
                # Already linked everywhere; semantic match is a no-op for v1.
                # The matched images are simply more likely to appear when the
                # user curates by deleting non-matching ones.
                break
            fi
        done
    done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

step "Bucket summary"
for b in "${WEATHER_BUCKETS[@]}"; do
    n="$(find "$WALL_ROOT/$b" -maxdepth 1 -type f | wc -l)"
    printf "  %-8s %d images   (time-of-day subdirs created, empty)\n" "$b" "$n" | tee -a "$LOG"
done

step "Done"
log "Wallpaper library ready at: $WALL_ROOT"
log "Curate per-bucket folders by deleting images that don't fit (e.g. remove non-rainy images from $WALL_ROOT/rain/)."
log "Drop morning/afternoon/evening/night-themed images into the corresponding subfolders to enable time-of-day variants."
log "Enable the extension with:  gnome-extensions enable gnomebeautifier@caio.jcalisto"
log "Log saved at: $LOG"
