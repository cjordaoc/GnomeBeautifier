#!/usr/bin/env bash
#
# GNOME Beautifier — extension installer.
# Packs src/ into a .zip, installs it via gnome-extensions, enables it,
# and prints next-step guidance. Idempotent.
#
# Usage:   bash install.sh
#          bash install.sh --pack-only        # produce dist/*.zip, do not install
#          bash install.sh --skip-wallpapers  # do not run scripts/setup-wallpapers.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="gnomebeautifier@caio.jcalisto"
PACK_ONLY=0
SKIP_WALLPAPERS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --pack-only)       PACK_ONLY=1; shift ;;
        --skip-wallpapers) SKIP_WALLPAPERS=1; shift ;;
        -h|--help)         sed -n '1,15p' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo "ERROR: gnome-extensions CLI not found. Install gnome-shell-extensions." >&2
    exit 1
fi

mkdir -p "$ROOT_DIR/dist"

echo "==> Packing extension"
(
    cd "$ROOT_DIR"
    gnome-extensions pack src \
        --schema=schemas/org.gnome.shell.extensions.gnomebeautifier.gschema.xml \
        --extra-source=modules \
        -o dist \
        --force
)

ZIP="$ROOT_DIR/dist/${UUID}.shell-extension.zip"
if [[ ! -f "$ZIP" ]]; then
    echo "ERROR: expected zip not produced at $ZIP" >&2
    exit 1
fi
echo "    built: $ZIP"

if [[ $PACK_ONLY -eq 1 ]]; then
    echo "Pack-only mode, stopping here."
    exit 0
fi

echo "==> Installing extension"
gnome-extensions install --force "$ZIP"

echo "==> Enabling extension"
gnome-extensions enable "$UUID" || true

if [[ $SKIP_WALLPAPERS -eq 0 ]]; then
    if [[ -x "$ROOT_DIR/scripts/setup-wallpapers.sh" ]]; then
        echo "==> Running wallpaper library setup (will request sudo)"
        bash "$ROOT_DIR/scripts/setup-wallpapers.sh"
    else
        chmod +x "$ROOT_DIR/scripts/setup-wallpapers.sh" || true
        bash "$ROOT_DIR/scripts/setup-wallpapers.sh"
    fi
fi

cat <<EOF

GNOME Beautifier installed.

Next steps:
  1. Log out and back in (or restart GNOME Shell on X11 with Alt+F2 -> r)
     so the new extension is picked up.
  2. Right-click on the desktop -> you should see:
       - GNOME Beautifier: Bucket: ...
       - Next Wallpaper
       - Previous Wallpaper
       - Refresh Weather Now
       - GNOME Beautifier Settings...
  3. Open settings to choose IP vs manual location, adjust rotation interval,
     and toggle accent / colour-scheme following.

EOF
