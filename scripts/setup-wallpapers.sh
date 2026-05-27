#!/usr/bin/env bash
#
# GNOME Beautifier — wallpaper library installer
#
# One-shot, idempotent. Populates ~/Pictures/Weather-Wallpapers/{bucket}
# with images sourced from the KDE / Plasma / GNOME system wallpaper
# packages. The running extension reads from these folders, but never
# invokes this script automatically — the user runs it deliberately
# because it needs sudo for the apt step.
#
# Buckets: clear, clouds, rain, storm, snow, fog, night, default
#
# Usage:   bash scripts/setup-wallpapers.sh [--no-install] [--root <path>]
# Env:     GNOMEBEAUTIFIER_WALLPAPER_ROOT (overrides --root)

set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
LOG="$HOME/gnomebeautifier-setup-${TS}.log"

WALL_ROOT="${GNOMEBEAUTIFIER_WALLPAPER_ROOT:-$HOME/Pictures/Weather-Wallpapers}"
DO_INSTALL=1
KDE_STAGING="$HOME/.cache/gnomebeautifier/staging-wallpapers"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-install) DO_INSTALL=0; shift ;;
        --root)       WALL_ROOT="$2"; shift 2 ;;
        -h|--help)
            sed -n '1,30p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

BUCKETS=(clear clouds rain storm snow fog night default)

log()  { echo "$@" | tee -a "$LOG"; }
step() { echo; log "===== $* ====="; }

step "GnomeBeautifier wallpaper setup"
log "Root:      $WALL_ROOT"
log "Staging:   $KDE_STAGING"
log "Log file:  $LOG"
log "Install:   $DO_INSTALL"

if [[ $DO_INSTALL -eq 1 ]]; then
    step "Install system wallpaper packages (sudo)"
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
            plasma-workspace-wallpapers \
            kde-wallpapers \
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

step "Stage system wallpapers into $KDE_STAGING"
rm -rf "$KDE_STAGING"
mkdir -p "$KDE_STAGING"

for src in \
    /usr/share/wallpapers \
    /usr/share/backgrounds \
    /usr/share/plasma/wallpapers
do
    if [[ -d "$src" ]]; then
        log "Scanning: $src"
        find "$src" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -print0 \
        | while IFS= read -r -d '' img; do
            safe_name="$(basename "$img" | tr ' ' '_' | tr -cd '[:alnum:]_.-')"
            cp -n "$img" "$KDE_STAGING/$safe_name" 2>/dev/null || true
        done
    fi
done

COUNT="$(find "$KDE_STAGING" -maxdepth 1 -type f | wc -l)"
log "Staged $COUNT images."
if [[ "$COUNT" -lt 1 ]]; then
    log "ERROR: no system wallpapers found. Install the relevant packages and rerun."
    exit 1
fi

step "Create bucket folders under $WALL_ROOT"
mkdir -p "$WALL_ROOT"
for b in "${BUCKETS[@]}"; do
    mkdir -p "$WALL_ROOT/$b"
done

step "Distribute staged images across buckets"
# We copy round-robin so each bucket gets several images, not just one.
# The extension cycles within each bucket; if a bucket is empty it falls
# back to "default" then "clear" (see src/modules/wallpaper.js).
mapfile -t IMAGES < <(find "$KDE_STAGING" -maxdepth 1 -type f \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) | sort)

idx=0
for img in "${IMAGES[@]}"; do
    bucket="${BUCKETS[$(( idx % ${#BUCKETS[@]} ))]}"
    ext="${img##*.}"
    base="$(basename "$img" ".$ext")"
    dest="$WALL_ROOT/$bucket/kde-${base}.${ext}"
    cp -f "$img" "$dest"
    idx=$(( idx + 1 ))
done

step "Bucket summary"
for b in "${BUCKETS[@]}"; do
    n="$(find "$WALL_ROOT/$b" -maxdepth 1 -type f | wc -l)"
    printf "  %-8s %d images\n" "$b" "$n" | tee -a "$LOG"
done

step "Done"
log "Wallpaper library ready at: $WALL_ROOT"
log "Enable the extension with:"
log "  gnome-extensions enable gnomebeautifier@caio.jcalisto"
log "Log saved at: $LOG"
