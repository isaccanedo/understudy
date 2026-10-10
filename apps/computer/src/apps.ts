import { existsSync } from "node:fs";
import { join } from "node:path";

export type DesktopApp = {
  id: string;
  name: string;
  color: string;
  icon: string;
  command: (home: string) => string[];
  installable?: { label: string; path: (home: string) => string };
};

const ICONS = {
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  terminal: '<path d="M5 8l4 4-4 4M12 16h7"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  writer: '<path d="M7 3h7l4 4v14H7zM10 12h6M10 16h6"/>',
  sheets: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  slides: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M12 17v3M8 20h8"/>',
  blender: '<circle cx="14" cy="13" r="6"/><circle cx="14" cy="13" r="2"/><path d="M3 9h7M5 13h3"/>',
  inkscape: '<path d="M4 20l5-14 3 8 2-4 6 10z"/>',
  gimp: '<path d="M12 3c5 0 9 3.5 9 8 0 3-2 4-4 4h-2a2 2 0 0 0-1 3.7c.6.6.3 2.3-2 2.3-5 0-9-4-9-9s4-9 9-9z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16" cy="10" r="1"/>',
};

const opt = (home: string, ...parts: string[]) => join(home, ".local", "opt", ...parts);

export const DESKTOP_APPS: DesktopApp[] = [
  { id: "browser", name: "Browser", color: "#3B93F0", icon: ICONS.browser, command: () => ["open-browser"] },
  { id: "terminal", name: "Terminal", color: "#2B2F3A", icon: ICONS.terminal, command: (home) => ["lxterminal", `--working-directory=${home}`] },
  { id: "files", name: "Files", color: "#F5C33B", icon: ICONS.files, command: (home) => ["pcmanfm", join(home, "files")] },
  { id: "writer", name: "Writer", color: "#4A7FE0", icon: ICONS.writer, command: () => ["libreoffice", "--writer"] },
  { id: "calc", name: "Sheets", color: "#3ECF8E", icon: ICONS.sheets, command: () => ["libreoffice", "--calc"] },
  { id: "impress", name: "Slides", color: "#FF8A3D", icon: ICONS.slides, command: () => ["libreoffice", "--impress"] },
  {
    id: "blender",
    name: "Blender",
    color: "#EA7600",
    icon: ICONS.blender,
    command: (home) => [opt(home, "blender", "blender")],
    installable: { label: "3D", path: (home) => opt(home, "blender", "blender") },
  },
  {
    id: "inkscape",
    name: "Inkscape",
    color: "#8B6CF6",
    icon: ICONS.inkscape,
    command: (home) => [opt(home, "inkscape", "AppRun")],
    installable: { label: "Vector", path: (home) => opt(home, "inkscape", "AppRun") },
  },
  {
    id: "gimp",
    name: "GIMP",
    color: "#5B6472",
    icon: ICONS.gimp,
    command: (home) => [opt(home, "gimp", "AppRun")],
    installable: { label: "Photo", path: (home) => opt(home, "gimp", "AppRun") },
  },
];

export function appInstalled(app: DesktopApp, home: string, exists: (path: string) => boolean = existsSync): boolean {
  return !app.installable || exists(app.installable.path(home));
}

export function findApp(id: string): DesktopApp | undefined {
  return DESKTOP_APPS.find((app) => app.id === id);
}

export const INSTALL_APP = `#!/bin/sh
set -eu
app="\${1:-}"
open_after="\${2:-}"
opt="$HOME/.local/opt"
mkdir -p "$opt" "$HOME/.cache/understudy-apps"
cache="$HOME/.cache/understudy-apps"
fetch() {
  url="$1"; sum="$2"; file="$cache/$3"
  if [ ! -f "$file" ] || ! echo "$sum  $file" | sha256sum -c - >/dev/null 2>&1; then
    echo "Downloading $3..."
    curl -fL --retry 3 -o "$file.part" "$url"
    echo "$sum  $file.part" | sha256sum -c - >/dev/null || { echo "Checksum mismatch for $3, refusing to install."; rm -f "$file.part"; exit 1; }
    mv "$file.part" "$file"
  fi
}
appimage() {
  name="$1"; file="$cache/$2"
  rm -rf "$opt/$name" "$cache/squashfs-root"
  chmod +x "$file"
  (cd "$cache" && "$file" --appimage-extract >/dev/null)
  mv "$cache/squashfs-root" "$opt/$name"
  rm -f "$file"
}
case "$app" in
  blender)
    fetch "https://download.blender.org/release/Blender4.5/blender-4.5.9-linux-x64.tar.xz" "dcdc3eca6c9825bb35a8033b689c053f3cb5a9b0cd2a61b2eac2a49436b4ad3d" blender.tar.xz
    rm -rf "$opt/blender" "$opt/blender-4.5.9-linux-x64"
    echo "Unpacking Blender..."
    tar -xJf "$cache/blender.tar.xz" -C "$opt"
    mv "$opt/blender-4.5.9-linux-x64" "$opt/blender"
    rm -f "$cache/blender.tar.xz"
    ln -sf "$opt/blender/blender" "$HOME/.local/bin/blender"
    run="$opt/blender/blender"
    ;;
  gimp)
    fetch "https://download.gimp.org/gimp/v3.0/linux/GIMP-3.0.8-x86_64.AppImage" "d19a8f83e06f9ec6a00927d895b822c7c8490ec19a6cb9f369498fdfdbcbea34" gimp.AppImage
    appimage gimp gimp.AppImage
    ln -sf "$opt/gimp/AppRun" "$HOME/.local/bin/gimp"
    run="$opt/gimp/AppRun"
    ;;
  inkscape)
    fetch "https://media.inkscape.org/dl/resources/file/Inkscape-ebf0e94-x86_64.AppImage" "99c333c03ce77e207942ddcd5c8a5b77cde89959a23651bc7872ae880cf4ba6b" inkscape.AppImage
    appimage inkscape inkscape.AppImage
    ln -sf "$opt/inkscape/AppRun" "$HOME/.local/bin/inkscape"
    run="$opt/inkscape/AppRun"
    ;;
  *)
    echo "usage: install-app blender|gimp|inkscape [--open]"
    exit 2
    ;;
esac
echo "$app is ready."
if [ "$open_after" = "--open" ]; then exec "$run"; fi
`;
