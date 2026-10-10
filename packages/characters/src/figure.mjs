import { accessory, accessoryFit, accessoryTransform } from "./accessories.mjs";

export { ACCESSORIES, accessory, accessoryColor, accessoryFit, accessoryTransform } from "./accessories.mjs";

export const SHAPES = ["circle", "pebble", "squircle", "capsule", "triangle", "hexagon", "cloud", "droplet"];

export const FACES = [
  "neutral",
  "attentive",
  "surprised",
  "excited",
  "happy",
  "laughing",
  "angry",
  "sad",
  "scared",
  "suspicious",
  "confused",
  "curious",
  "proud",
  "shy",
  "unimpressed",
  "sleepy",
];

export const COLORS = ["#3B93F0", "#3ECF8E", "#FF8A3D", "#F25C8A", "#8B6CF6", "#F5C33B", "#2EC4C6", "#EF5350", "#E9E6DF", "#5B6472"];

const HOLE = "#0E0F12";
const BLUSH = "#FF7A93";

const ring = (count, radius, cornerRadius, rotation = 0, cy = 0) =>
  Array.from({ length: count }, (_, i) => {
    const angle = rotation + (i / count) * Math.PI * 2;
    return { x: Math.cos(angle) * (radius - cornerRadius), y: cy + Math.sin(angle) * (radius - cornerRadius), r: cornerRadius };
  });

const HULLS = {
  circle: [{ x: 0, y: 0, r: 98 }],
  pebble: [
    { x: -38, y: 6, r: 74 },
    { x: 34, y: 10, r: 70 },
    { x: 6, y: -18, r: 74 },
  ],
  squircle: ring(4, 128, 44, Math.PI / 4),
  capsule: [
    { x: -52, y: 0, r: 70 },
    { x: 52, y: 0, r: 70 },
  ],
  triangle: ring(3, 126, 30, -Math.PI / 2, 22),
  hexagon: ring(6, 106, 24, 0),
  droplet: [
    { x: 0, y: 26, r: 80 },
    { x: 0, y: -100, r: 7 },
  ],
};

const CLOUD = [
  { x: -6, y: -36, r: 54 },
  { x: -58, y: 4, r: 44 },
  { x: 58, y: 0, r: 46 },
  { x: -28, y: 42, r: 46 },
  { x: 30, y: 42, r: 48 },
  { x: 40, y: -34, r: 38 },
];

const FACE_CENTER = {
  circle: [0, -6, 1.22],
  pebble: [0, -6, 1.2],
  squircle: [0, -6, 1.22],
  capsule: [0, -2, 1.12],
  triangle: [0, 34, 1],
  hexagon: [0, -2, 1.18],
  cloud: [0, 4, 1.18],
  droplet: [0, 34, 1.08],
};

const n = (value) => Math.round(value * 100) / 100;

function hullPoints(circles, steps = 240) {
  const points = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = circles[0];
    let reach = -Infinity;
    for (const c of circles) {
      const value = c.x * dx + c.y * dy + c.r;
      if (value > reach) {
        reach = value;
        best = c;
      }
    }
    points.push([best.x + best.r * dx, best.y + best.r * dy]);
  }
  return points;
}

function unionPoints(circles, steps = 200, smooth = 4) {
  const radii = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let far = 0;
    for (const c of circles) {
      const along = c.x * ux + c.y * uy;
      const disc = along * along - (c.x * c.x + c.y * c.y - c.r * c.r);
      if (disc >= 0) far = Math.max(far, along + Math.sqrt(disc));
    }
    radii.push(far);
  }
  return radii.map((_, i) => {
    let sum = 0;
    for (let k = -smooth; k <= smooth; k++) sum += radii[(i + k + steps) % steps];
    const radius = sum / (smooth * 2 + 1);
    const angle = (i / steps) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function polygonPath(points) {
  return `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;
}

const outlineCache = new Map();

export function outline(shape, grow = 0) {
  const key = `${shape}:${grow}`;
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const circles = (shape === "cloud" ? CLOUD : HULLS[shape] ?? HULLS.circle).map((c) => ({ ...c, r: c.r + grow }));
  const points = hullPoints(circles, 180);
  outlineCache.set(key, points);
  return points;
}

const bodyCache = new Map();

export function body(shape) {
  const key = SHAPES.includes(shape) ? shape : "circle";
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const points = key === "cloud" ? unionPoints(CLOUD) : hullPoints(HULLS[key]);
  const ys = points.map(([, y]) => y);
  const xs = points.map(([x]) => x);
  const result = {
    points,
    d: polygonPath(points),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    face: FACE_CENTER[key],
  };
  bodyCache.set(key, result);
  return result;
}

const pill = (w, h) => {
  const r = Math.min(w, h) / 2;
  const x = w / 2;
  const y = h / 2;
  return `M${n(-x + r)} ${n(-y)}H${n(x - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(-y + r)}V${n(y - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x - r)} ${n(y)}H${n(-x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(-x)} ${n(y - r)}V${n(-y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(-x + r)} ${n(-y)}Z`;
};

const lid = (w, h) => {
  const a = w / 2;
  const top = -h / 2;
  const turn = h / 2 - a;
  return `M${n(-a)} ${n(top + 3)}Q${n(-a)} ${n(top)} ${n(-a + 3)} ${n(top)}H${n(a - 3)}Q${n(a)} ${n(top)} ${n(a)} ${n(top + 3)}V${n(turn)}A${n(a)} ${n(a)} 0 0 1 ${n(-a)} ${n(turn)}Z`;
};

const arc = (w, h) => `M${n(-w / 2)} ${n(h / 2)}Q0 ${n(-h * 1.5)} ${n(w / 2)} ${n(h / 2)}`;
const cup = (w, h) => `M${n(-w / 2)} ${n(-h / 2)}Q0 ${n(h * 1.5)} ${n(w / 2)} ${n(-h / 2)}`;

const E = {
  pill: (w, h, extra = {}) => ({ d: pill(w, h), ...extra }),
  lid: (w, h, extra = {}) => ({ d: lid(w, h), ...extra }),
  arc: (w, h, extra = {}) => ({ d: arc(w, h), stroke: 8, ...extra }),
  cup: (w, h, extra = {}) => ({ d: cup(w, h), stroke: 8, ...extra }),
};

const both = (eye, gap = 26) => [
  { ...eye, x: -gap },
  { ...eye, x: gap, rot: -(eye.rot ?? 0) },
];

const FACE_DEFS = {
  neutral: { eyes: both(E.pill(17, 34)) },
  attentive: { eyes: both(E.pill(20, 40), 24) },
  surprised: { eyes: both(E.pill(24, 26), 30), mouth: { d: pill(14, 16), y: 36 } },
  excited: { eyes: both(E.pill(22, 40), 28), mouth: { d: "M-13 0H13Q13 16 0 16T-13 0Z", y: 30 } },
  happy: { eyes: both(E.arc(24, 12), 28), mouth: { d: cup(22, 8), stroke: 7, y: 32 } },
  laughing: { eyes: both(E.arc(24, 12), 28), mouth: { d: "M-17 0H17Q17 22 0 22T-17 0Z", y: 26 } },
  angry: { eyes: both(E.lid(22, 26, { rot: 22 }), 27), mouth: { d: arc(20, 6), stroke: 7, y: 36 } },
  sad: { eyes: both(E.pill(16, 26), 26), mouth: { d: arc(22, 9), stroke: 7, y: 36 }, look: [0, 0.45] },
  scared: { eyes: both(E.pill(14, 22), 30), mouth: { d: "M-14 2Q-10 -4 -5 2T5 2T14 2", stroke: 6, y: 36 } },
  suspicious: { eyes: [{ ...E.pill(17, 34), x: -24 }, { ...E.pill(24, 12), x: 26, y: 6, rot: -8 }] },
  confused: { eyes: [{ ...E.pill(17, 34), x: -24, y: 2 }, { ...E.pill(15, 24), x: 26, y: -8, rot: 10 }], mouth: { d: "M-12 2Q-6 -4 0 1T12 -2", stroke: 6, y: 36 } },
  curious: { eyes: [{ ...E.pill(22, 42), x: -25, rot: -6 }, { ...E.pill(17, 32), x: 25, y: 2, rot: 6 }] },
  proud: { eyes: both(E.arc(22, 10), 27), mouth: { d: cup(18, 7), stroke: 7, y: 32, x: 8, rot: -10 } },
  shy: { eyes: both(E.pill(14, 20), 26), blush: true, look: [0.2, 0.55] },
  unimpressed: { eyes: both(E.lid(20, 18), 27), mouth: { d: "M-10 0H10", stroke: 7, y: 34 } },
  sleepy: { eyes: both(E.cup(22, 8), 27), mouth: { d: pill(10, 12), y: 34 } },
};

export function face(name) {
  return FACE_DEFS[name] ?? FACE_DEFS.neutral;
}

function hex(color) {
  const value = /^#[0-9a-fA-F]{6}$/.test(color) ? color : COLORS[0];
  const int = parseInt(value.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function mix(color, target, amount) {
  const from = hex(color);
  return `#${from.map((c, i) => Math.round(c + (target[i] - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function tones(color) {
  return {
    light: mix(color, [255, 255, 255], 0.55),
    mid: mix(color, [255, 255, 255], 0.18),
    base: mix(color, [255, 255, 255], 0),
    dark: mix(color, [8, 10, 20], 0.42),
  };
}

export const REST = { gx: 0, gy: 0, blink: 0, sx: 1, sy: 1, lift: 0, tilt: 0 };

export function eyeTransform(spec, eye, side, pose) {
  const [cx, cy, scale] = body(spec.shape).face;
  const gx = Math.max(-1, Math.min(1, pose.gx));
  const gy = Math.max(-1, Math.min(1, pose.gy));
  const tx = cx + eye.x * scale + gx * 15 * scale;
  const ty = cy + (eye.y ?? 0) * scale + gy * 11;
  const rot = ((eye.rot ?? 0) * Math.PI) / 180;
  const squeeze = side === "mouth" ? 1 : 1 - Math.min(1, pose.blink) * 0.9;
  const sx = scale * (1 - Math.abs(gx) * 0.14);
  const sy = scale * (1 - Math.abs(gy) * 0.1) * squeeze;
  const shear = gx * 0.16;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const a = sx * cos;
  const b = sx * sin - gy * 0.04 * gx;
  const c = -sy * sin + shear * sy;
  const d = sy * cos;
  return `matrix(${n(a)},${n(b)},${n(c)},${n(d)},${n(tx)},${n(ty)})`;
}

export function bodyTransform(spec, pose) {
  const ground = body(spec.shape).bottom;
  const fit = accessoryFit(spec);
  return `translate(0 ${n(ground + pose.lift)}) rotate(${n(pose.tilt)}) scale(${n(pose.sx * fit)} ${n(pose.sy * fit)}) translate(0 ${n(-ground)})`;
}

export function shadowTransform(spec, pose) {
  const ground = body(spec.shape).bottom;
  const shrink = Math.max(0.55, 1 + pose.lift / 60) * accessoryFit(spec);
  return `translate(0 ${n(ground + 8)}) scale(${n(shrink * pose.sx)} ${n(shrink)})`;
}

export function parts(spec) {
  const shape = body(spec.shape);
  const look = face(spec.face);
  const marks = look.eyes.map((eye, i) => ({ ...eye, side: i === 0 ? "left" : "right" }));
  if (look.mouth) marks.push({ ...look.mouth, x: look.mouth.x ?? 0, side: "mouth" });
  return { shape, look, marks, tones: tones(spec.color), viewBox: "-128 -128 256 256" };
}

export function markElement(mark, transform) {
  return mark.stroke
    ? `<path d="${mark.d}" transform="${transform}" fill="none" stroke="#000" stroke-width="${mark.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${mark.d}" transform="${transform}" fill="#000"/>`;
}

export function figure(spec, id = "f", pose = REST) {
  const key = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  const { shape, look, marks, tones: t, viewBox } = parts(spec);
  const full = { ...REST, ...(look.look ? { gx: look.look[0], gy: look.look[1] } : {}), ...pose };
  const eyes = marks.map((mark) => markElement(mark, eyeTransform(spec, mark, mark.side, full))).join("");
  const [fx, fy, scale] = shape.face;
  const blush = look.blush
    ? `<ellipse cx="${n(fx - 44 * scale)}" cy="${n(fy + 24 * scale)}" rx="13" ry="8" fill="${BLUSH}" opacity=".55"/><ellipse cx="${n(fx + 44 * scale)}" cy="${n(fy + 24 * scale)}" rx="13" ry="8" fill="${BLUSH}" opacity=".55"/>`
    : "";
  const extra = accessory(spec, key);
  const sway = extra ? accessoryTransform(spec, full) : "";
  const layer = (markup) => (markup ? `<g transform="${sway}">${markup}</g>` : "");
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg"><defs>${extra?.defs ?? ""}<radialGradient id="${key}-fill" gradientUnits="userSpaceOnUse" cx="-42" cy="-58" r="236"><stop offset="0" stop-color="${t.light}"/><stop offset=".3" stop-color="${t.mid}"/><stop offset=".68" stop-color="${t.base}"/><stop offset="1" stop-color="${t.dark}"/></radialGradient><radialGradient id="${key}-shadow"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><mask id="${key}-mask" maskUnits="userSpaceOnUse" x="-160" y="-160" width="320" height="320"><path d="${shape.d}" fill="#fff"/>${eyes}</mask></defs><ellipse rx="${n(shape.width * 0.42)}" ry="9" fill="url(#${key}-shadow)" transform="${shadowTransform(spec, full)}"/><g transform="${bodyTransform(spec, full)}">${layer(extra?.back)}<path d="${shape.d}" fill="${HOLE}"/><g mask="url(#${key}-mask)"><rect x="-160" y="-160" width="320" height="320" fill="url(#${key}-fill)"/></g>${blush}${layer(extra?.front)}</g></svg>`;
}
