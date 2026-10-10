import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ComputerToServer, InputEvent } from "@understudy/protocol";
import { log } from "@understudy/runtime";
import { DESKTOP_APPS, INSTALL_APP } from "./apps.ts";

export const DISPLAY = ":99";
export const SCREEN = { width: 1440, height: 900 };
export const DOCK_HEIGHT = 60;
export const DOCK_GAP = 14;
export const PANEL_HEIGHT = DOCK_HEIGHT + DOCK_GAP;
export const WALLPAPER = { top: "#fffaf4", bottom: "#efe4d6" };

const FRAME_RATE = 5;
export const INTERACTIVE_FRAME_RATE = 15;
export const INTERACTIVE_WINDOW_MS = 4000;
const MAX_PENDING_BYTES = 4 * 1024 * 1024;

export function desktopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNDERSTUDY_DESKTOP !== "0";
}

export const SECRET_ENV = ["AGENT_TOKEN", "UNDERSTUDY_VAULT_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];

export function desktopAppEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env, HOME: home, DISPLAY };
  for (const name of SECRET_ENV) delete clean[name];
  return clean;
}

export const OPEN_NEWEST = `#!/bin/sh
newest=$(ls -t "$HOME/files/outbox" 2>/dev/null | head -n 1)
[ -n "$newest" ] || exit 0
exec soffice --norestore --nologo "$HOME/files/outbox/$newest"
`;

export const LIBREOFFICE_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="ShowTipOfTheDay" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

export const OPENBOX_MENU = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu xmlns="http://openbox.org/3.4/menu">
  <menu id="root-menu" label="Understudy">
${DESKTOP_APPS.map((app) => `    <item label="${app.name}"><action name="Execute"><command>open-app ${app.id}</command></action></item>`).join("\n")}
    <separator/>
    <item label="Open the newest file in the outbox"><action name="Execute"><command>open-newest</command></action></item>
  </menu>
</openbox_menu>
`;

export const OPENBOX_RC = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme>
    <name>Understudy</name>
    <titleLayout>NLIMC</titleLayout>
    <keepBorder>no</keepBorder>
    <font place="ActiveWindow"><name>Poppins</name><size>9</size><weight>Bold</weight></font>
    <font place="InactiveWindow"><name>Poppins</name><size>9</size></font>
    <font place="MenuItem"><name>Poppins</name><size>10</size></font>
  </theme>
  <focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>
  <placement><policy>Smart</policy><center>yes</center></placement>
  <desktops><number>1</number></desktops>
  <margins><top>0</top><bottom>${PANEL_HEIGHT}</bottom><left>0</left><right>0</right></margins>
  <keyboard>
    <keybind key="A-Tab"><action name="NextWindow"/></keybind>
    <keybind key="W-space"><action name="ShowMenu"><menu>root-menu</menu></action></keybind>
    <keybind key="A-F1"><action name="ShowMenu"><menu>root-menu</menu></action></keybind>
    <keybind key="W-o"><action name="Execute"><command>open-newest</command></action></keybind>
    <keybind key="W-t"><action name="Execute"><command>lxterminal</command></action></keybind>
  </keyboard>
  <mouse>
    <context name="Root"><mousebind button="Right" action="Press"><action name="ShowMenu"><menu>root-menu</menu></action></mousebind></context>
    <context name="Titlebar"><mousebind button="Left" action="Drag"><action name="Move"/></mousebind><mousebind button="Left" action="DoubleClick"><action name="ToggleMaximize"/></mousebind></context>
    <context name="Frame"><mousebind button="A-Left" action="Drag"><action name="Move"/></mousebind></context>
    <context name="Close"><mousebind button="Left" action="Click"><action name="Close"/></mousebind></context>
    <context name="Maximize"><mousebind button="Left" action="Click"><action name="ToggleMaximize"/></mousebind></context>
    <context name="Iconify"><mousebind button="Left" action="Click"><action name="Iconify"/></mousebind></context>
    <context name="Client"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind></context>
  </mouse>
  <menu><file>menu.xml</file></menu>
  <applications>
    <application class="*"><decor>yes</decor><focus>yes</focus></application>
    <application class="*hrom*"><decor>no</decor><maximized>yes</maximized></application>
    <application class="libreoffice*"><maximized>yes</maximized></application>
    <application class="Soffice"><maximized>yes</maximized></application>
    <application class="Lxterminal"><position force="yes"><x>center</x><y>center</y></position><size><width>860</width><height>520</height></size></application>
    <application class="Pcmanfm"><position force="yes"><x>center</x><y>center</y></position><size><width>900</width><height>560</height></size></application>
  </applications>
</openbox_config>
`;

const launcher = (name: string, exec: string, icon: string) => `[Desktop Entry]
Type=Application
Name=${name}
Exec=${exec}
Icon=${icon}
Terminal=false
`;

export const DOCK_APPS = ["browser", "terminal", "files"];

const quote = (arg: string) => `'${arg.replaceAll("'", "'\\''")}'`;

export function openAppScript(home: string): string {
  const cases = DESKTOP_APPS.map((app) => {
    const run = `exec ${app.command(home).map(quote).join(" ")} "$@"`;
    if (!app.installable) return `  ${app.id}) ${run} ;;`;
    return `  ${app.id}) [ -x ${quote(app.installable.path(home))} ] || exec lxterminal ${quote(`--title=Installing ${app.name}`)} -e ${quote(`install-app ${app.id} --open`)}; ${run} ;;`;
  }).join("\n");
  return `#!/bin/sh\napp="$1"\n[ $# -gt 0 ] && shift\ncase "$app" in\n${cases}\n  *) echo "usage: open-app ${DESKTOP_APPS.map((app) => app.id).join("|")}"; exit 2 ;;\nesac\n`;
}

export function desktopLaunchers(): Record<string, string> {
  const icons: Record<string, string> = { browser: "google-chrome", terminal: "utilities-terminal", files: "system-file-manager", writer: "libreoffice-writer", calc: "libreoffice-calc", impress: "libreoffice-impress", blender: "blender", inkscape: "inkscape", gimp: "gimp" };
  return Object.fromEntries(DESKTOP_APPS.map((app) => [`${app.id}.desktop`, launcher(app.name, `open-app ${app.id}`, icons[app.id] ?? "application-x-executable")]));
}

export function tint2Config(home: string): string {
  const apps = DOCK_APPS.map((id) => `launcher_item_app = ${home}/.local/share/applications/${id}.desktop`).join("\n");
  return `rounded = 18
border_width = 1
border_sides = TBLR
background_color = #ffffff 100
border_color = #e3d7c7 100
rounded = 11
border_width = 0
background_color = #000000 0
border_color = #000000 0
rounded = 11
border_width = 0
background_color = #f1e8dc 100
border_color = #000000 0
panel_items = LT
panel_size = 100% ${DOCK_HEIGHT}
panel_shrink = 1
panel_margin = 0 ${DOCK_GAP}
panel_padding = 10 8 8
panel_background_id = 1
panel_position = bottom center horizontal
panel_layer = top
panel_dock = 0
strut_policy = follow_size
font_shadow = 0
launcher_padding = 2 0 8
launcher_background_id = 0
launcher_icon_size = 40
launcher_icon_theme = Papirus
launcher_tooltip = 1
${apps}
taskbar_mode = single_desktop
taskbar_padding = 8 0 6
taskbar_background_id = 0
task_icon = 1
task_text = 0
task_centered = 1
task_maximum_size = 46 46
task_padding = 4 4 0
task_background_id = 2
task_active_background_id = 3
task_iconified_background_id = 2
tooltip_font = Poppins 9
tooltip_font_color = #2b2621 100
tooltip_background_id = 1
`;
}

export const OPENBOX_THEME = `border.width: 1
padding.width: 10
padding.height: 7
window.handle.width: 0
window.client.padding.width: 0
window.client.padding.height: 0
window.active.border.color: #e3d7c7
window.inactive.border.color: #ebe1d4
window.active.title.bg: flat solid
window.active.title.bg.color: #f6f1ea
window.inactive.title.bg: flat solid
window.inactive.title.bg.color: #fbf8f3
window.active.label.bg: parentrelative
window.inactive.label.bg: parentrelative
window.active.label.text.color: #2b2621
window.inactive.label.text.color: #a4977f
window.label.text.justify: center
window.active.button.unpressed.bg: parentrelative
window.active.button.unpressed.image.color: #7a6f63
window.inactive.button.unpressed.bg: parentrelative
window.inactive.button.unpressed.image.color: #c9bdaa
window.active.button.hover.bg: flat solid
window.active.button.hover.bg.color: #ebe1d4
window.active.button.hover.image.color: #2b2621
window.active.button.pressed.bg: flat solid
window.active.button.pressed.bg.color: #e3d7c7
window.active.button.pressed.image.color: #2b2621
window.active.button.disabled.bg: parentrelative
window.active.button.disabled.image.color: #c9bdaa
window.inactive.button.hover.bg: flat solid
window.inactive.button.hover.bg.color: #ebe1d4
window.inactive.button.hover.image.color: #2b2621
window.inactive.button.pressed.bg: flat solid
window.inactive.button.pressed.bg.color: #e3d7c7
window.inactive.button.pressed.image.color: #2b2621
window.inactive.button.disabled.bg: parentrelative
window.inactive.button.disabled.image.color: #c9bdaa
menu.border.width: 1
menu.border.color: #e3d7c7
menu.overlap: 0
menu.title.bg: flat solid
menu.title.bg.color: #f6f1ea
menu.title.text.color: #2b2621
menu.title.text.justify: center
menu.items.bg: flat solid
menu.items.bg.color: #ffffff
menu.items.text.color: #2b2621
menu.items.disabled.text.color: #c9bdaa
menu.items.active.bg: flat solid
menu.items.active.bg.color: #f1e8dc
menu.items.active.text.color: #2b2621
menu.separator.color: #ebe1d4
osd.border.width: 1
osd.border.color: #e3d7c7
osd.bg: flat solid
osd.bg.color: #ffffff
osd.label.bg: parentrelative
osd.label.text.color: #2b2621
osd.hilight.bg: flat solid
osd.hilight.bg.color: #e3d7c7
osd.unhilight.bg: flat solid
osd.unhilight.bg.color: #f6f1ea
`;

export const PICOM_CONF = `backend = "xrender";
vsync = false;
corner-radius = 12;
shadow = true;
shadow-radius = 18;
shadow-opacity = 0.18;
shadow-offset-x = -14;
shadow-offset-y = -8;
shadow-exclude = [ "class_g = 'Tint2'" ];
fading = false;
`;

export const GTK2_SETTINGS = `gtk-theme-name="Adwaita"
gtk-icon-theme-name="Papirus"
gtk-font-name="Poppins 10"
`;

export const GTK_SETTINGS = `[Settings]
gtk-theme-name=Adwaita
gtk-icon-theme-name=Papirus
gtk-font-name=Poppins 10
gtk-application-prefer-dark-theme=0
`;

export const LXTERMINAL_CONF = `[general]
fontname=DejaVu Sans Mono 11
bgcolor=rgb(14,16,24)
fgcolor=rgb(230,230,230)
scrollback=5000
hidescrollbar=true
hidemenubar=true
hideclosebutton=true
tabpos=top
color_preset=Custom
palette_color_4=rgb(99,161,255)
palette_color_12=rgb(140,186,255)
palette_color_2=rgb(89,212,153)
palette_color_10=rgb(120,230,180)
`;

export function splitJpegs(buffer: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
  while (start >= 0) {
    const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) break;
    frames.push(buffer.subarray(start, end + 2));
    start = buffer.indexOf(Buffer.from([0xff, 0xd8]), end + 2);
  }
  return { frames, rest: start >= 0 ? buffer.subarray(start) : Buffer.alloc(0) };
}

const KEYSYMS: Record<string, string> = {
  Enter: "Return",
  Backspace: "BackSpace",
  Tab: "Tab",
  Escape: "Escape",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "Prior",
  PageDown: "Next",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Shift: "Shift_L",
  Control: "Control_L",
  Alt: "Alt_L",
  Meta: "Super_L",
  " ": "space",
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`])),
};

export function xdotoolArgs(event: Exclude<InputEvent, { kind: "navigate" }>): string[] | null {
  if (event.kind === "mouse") {
    const x = String(Math.max(0, Math.min(SCREEN.width - 1, Math.round(event.x))));
    const y = String(Math.max(0, Math.min(SCREEN.height - 1, Math.round(event.y))));
    const button = event.button === "right" ? "3" : "1";
    if (event.action === "move") return ["mousemove", x, y];
    if (event.action === "down") return ["mousemove", x, y, "mousedown", button];
    if (event.action === "up") return ["mousemove", x, y, "mouseup", button];
    const clicks = Math.max(1, Math.min(10, Math.round(Math.abs(event.deltaY ?? 0) / 100) || 1));
    return ["mousemove", x, y, "click", "--repeat", String(clicks), (event.deltaY ?? 0) > 0 ? "5" : "4"];
  }
  if (event.action === "char") return event.text || event.key ? ["type", "--delay", "0", "--", event.text ?? event.key] : null;
  const keysym = KEYSYMS[event.key];
  if (keysym) return [event.action === "up" ? "keyup" : "keydown", keysym];
  if (event.action === "down" && event.text && event.text.length === 1) return ["type", "--delay", "0", "--", event.text];
  if (event.key.length === 1 && /^[\x21-\x7e]$/.test(event.key)) return [event.action === "up" ? "keyup" : "keydown", event.key];
  return null;
}

export function runXdotool(args: string[], env: NodeJS.ProcessEnv, command = "xdotool"): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.on("error", done);
    child.on("close", done);
  });
}

export function inputSerializer(run: (args: string[]) => Promise<void>) {
  const pending: { args: string[]; done: (() => void)[] }[] = [];
  let working = false;
  const isMove = (args: string[]) => args.length === 3 && args[0] === "mousemove";
  const work = async () => {
    if (working) return;
    working = true;
    while (pending.length) {
      const next = pending.shift()!;
      await run(next.args);
      for (const done of next.done) done();
    }
    working = false;
  };
  return (args: string[]) =>
    new Promise<void>((resolve) => {
      const last = pending.at(-1);
      if (last && isMove(last.args) && isMove(args)) {
        last.args = args;
        last.done.push(resolve);
      } else pending.push({ args, done: [resolve] });
      void work();
    });
}

export function frameGate(now: () => number = Date.now) {
  let lastInput = Number.NEGATIVE_INFINITY;
  let lastSent = Number.NEGATIVE_INFINITY;
  return {
    touched() {
      lastInput = now();
    },
    shouldSend() {
      const at = now();
      const interactive = at - lastInput < INTERACTIVE_WINDOW_MS;
      if (!interactive && at - lastSent < 1000 / FRAME_RATE - 5) return false;
      lastSent = at;
      return true;
    },
  };
}

export type Desktop = {
  env: NodeJS.ProcessEnv;
  appEnv: NodeJS.ProcessEnv;
  input: (event: Exclude<InputEvent, { kind: "navigate" }>) => void;
  stream: (send: (message: ComputerToServer) => boolean, pressure: () => number, url: () => string) => { start: () => void; stop: () => void };
  close: () => void;
};

export async function startDesktop(home: string): Promise<Desktop | null> {
  const env = { ...process.env, DISPLAY };
  const children: ChildProcess[] = [];
  for (const stale of [`/tmp/.X${DISPLAY.slice(1)}-lock`, `/tmp/.X11-unix/X${DISPLAY.slice(1)}`]) rmSync(stale, { force: true });
  const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", `${SCREEN.width}x${SCREEN.height}x24`, "-nolisten", "tcp", "-ac"], { stdio: "ignore" });
  children.push(xvfb);
  const socket = `/tmp/.X11-unix/X${DISPLAY.slice(1)}`;
  for (let tries = 0; tries < 50 && !existsSync(socket); tries++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!existsSync(socket) && xvfb.exitCode !== null) {
    log("desktop", "Xvfb did not start; falling back to the headless browser");
    return null;
  }
  const config = join(home, ".config", "openbox");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "menu.xml"), OPENBOX_MENU);
  writeFileSync(join(config, "rc.xml"), OPENBOX_RC);
  const applications = join(home, ".local", "share", "applications");
  mkdirSync(applications, { recursive: true });
  for (const [file, entry] of Object.entries(desktopLaunchers())) writeFileSync(join(applications, file), entry);
  const tint2 = join(home, ".config", "tint2");
  mkdirSync(tint2, { recursive: true });
  writeFileSync(join(tint2, "tint2rc"), tint2Config(home));
  const theme = join(home, ".themes", "Understudy", "openbox-3");
  mkdirSync(theme, { recursive: true });
  writeFileSync(join(theme, "themerc"), OPENBOX_THEME);
  writeFileSync(join(home, ".gtkrc-2.0"), GTK2_SETTINGS);
  const gtk = join(home, ".config", "gtk-3.0");
  mkdirSync(gtk, { recursive: true });
  writeFileSync(join(gtk, "settings.ini"), GTK_SETTINGS);
  const lxterminal = join(home, ".config", "lxterminal");
  mkdirSync(lxterminal, { recursive: true });
  writeFileSync(join(lxterminal, "lxterminal.conf"), LXTERMINAL_CONF);
  mkdirSync(join(home, "files"), { recursive: true });
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "open-newest"), OPEN_NEWEST, { mode: 0o755 });
  writeFileSync(join(bin, "open-app"), openAppScript(home), { mode: 0o755 });
  writeFileSync(join(bin, "install-app"), INSTALL_APP, { mode: 0o755 });
  const office = join(home, ".config", "libreoffice", "4", "user");
  mkdirSync(office, { recursive: true });
  writeFileSync(join(office, "registrymodifications.xcu"), LIBREOFFICE_SETTINGS);
  const appEnv = desktopAppEnv(process.env, home);
  appEnv.PATH = `${bin}:${appEnv.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`;
  spawn("hsetroot", ["-add", WALLPAPER.bottom, "-add", WALLPAPER.top, "-gradient", "0"], { env: appEnv, stdio: "ignore" }).on("error", () => {});
  children.push(spawn("openbox", ["--config-file", join(config, "rc.xml")], { env: appEnv, stdio: "ignore" }));
  writeFileSync(join(home, ".config", "picom.conf"), PICOM_CONF);
  const compositor = spawn("picom", ["--config", join(home, ".config", "picom.conf")], { env: appEnv, stdio: "ignore" });
  compositor.on("error", () => log("desktop", "picom is missing; windows have square corners"));
  children.push(compositor);
  const panel = spawn("tint2", ["-c", join(tint2, "tint2rc")], { env: appEnv, stdio: "ignore" });
  panel.on("error", () => log("desktop", "tint2 is missing; the desktop has no app bar"));
  children.push(panel);
  log("desktop", `desktop on ${DISPLAY}`);
  const enqueue = inputSerializer((args) => runXdotool(args, env));
  const gate = frameGate();

  return {
    env,
    appEnv,
    input(event) {
      const args = xdotoolArgs(event);
      if (!args) return;
      gate.touched();
      void enqueue(args);
    },
    stream(send, pressure, url) {
      let ffmpeg: ChildProcess | null = null;
      return {
        start() {
          if (ffmpeg) return;
          const started = spawn(
            "ffmpeg",
            ["-loglevel", "error", "-f", "x11grab", "-draw_mouse", "1", "-framerate", String(INTERACTIVE_FRAME_RATE), "-video_size", `${SCREEN.width}x${SCREEN.height}`, "-i", DISPLAY, "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "6", "-"],
            { env, stdio: ["ignore", "pipe", "ignore"] },
          );
          ffmpeg = started;
          let buffer: Buffer = Buffer.alloc(0);
          started.stdout?.on("data", (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            const { frames, rest } = splitJpegs(buffer);
            buffer = rest.length > 8 * 1024 * 1024 ? Buffer.alloc(0) : rest;
            const latest = frames.at(-1);
            if (!latest || pressure() > MAX_PENDING_BYTES || !gate.shouldSend()) return;
            send({ type: "frame", jpegBase64: latest.toString("base64"), width: SCREEN.width, height: SCREEN.height, url: url(), desktop: true });
          });
          started.on("exit", () => {
            if (ffmpeg === started) ffmpeg = null;
          });
        },
        stop() {
          ffmpeg?.kill("SIGTERM");
          ffmpeg = null;
        },
      };
    },
    close() {
      for (const child of children) child.kill("SIGTERM");
    },
  };
}
