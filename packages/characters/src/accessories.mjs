import { body, COLORS, outline, SHAPES, tones } from "./figure.mjs";

export const ACCESSORIES = ["none", "sprout", "flower", "bow", "antenna", "beanie", "cap", "party", "crown", "headphones", "glasses", "scarf", "bowtie"];

const NATURAL = {
  sprout: ["#3ECF8E", "#F5C33B"],
  flower: ["#F25C8A", "#F5C33B"],
  bow: ["#EF5350", "#8B6CF6"],
  antenna: ["#FF8A3D", "#F25C8A"],
  beanie: ["#FF8A3D", "#3B93F0"],
  cap: ["#3B93F0", "#EF5350"],
  party: ["#8B6CF6", "#F25C8A"],
  crown: ["#F5C33B", "#E9E6DF"],
  headphones: ["#5B6472", "#E9E6DF"],
  glasses: ["#5B6472", "#E9E6DF"],
  scarf: ["#EF5350", "#3B93F0"],
  bowtie: ["#8B6CF6", "#EF5350"],
};

export function accessoryColor(acc, bodyColor) {
  const [first, second] = NATURAL[acc] ?? [COLORS[0], COLORS[1]];
  return first.toUpperCase() === String(bodyColor).toUpperCase() ? second : first;
}

const CREAM = "#F6F1E7";
const n = (value) => Math.round(value * 100) / 100;

const anchorCache = new Map();

function edgesAt(points, y) {
  const xs = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    if ((y1 - y) * (y2 - y) <= 0 && y1 !== y2) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 0];
}

function topAt(points, x) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    if ((x1 - x) * (x2 - x) <= 0 && x1 !== x2) best = Math.min(best, y1 + ((x - x1) / (x2 - x1)) * (y2 - y1));
  }
  return best;
}

function pointAt(points, degrees, origin = [0, 0], inset = 0) {
  const angle = (degrees * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const [ox, oy] = origin;
  let reach = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const ex = x2 - x1;
    const ey = y2 - y1;
    const det = ex * dy - ey * dx;
    if (Math.abs(det) < 1e-9) continue;
    const t = (ex * (y1 - oy) - ey * (x1 - ox)) / det;
    const u = (dx * (y1 - oy) - dy * (x1 - ox)) / det;
    if (u >= 0 && u <= 1 && t > reach) reach = t;
  }
  return [ox + dx * (reach - inset), oy + dy * (reach - inset)];
}

function anchors(shape) {
  const hit = anchorCache.get(shape);
  if (hit) return hit;
  const b = body(shape);
  const [fx, fy, s] = b.face;
  const hull = outline(shape, 0);
  const top = topAt(hull, 0);
  const eyeLimit = fy - 22 * s - 15;
  const seat = Math.max(top + 30, Math.min(top + 58, eyeLimit));
  const neck = Math.min(fy + 47 * s, b.bottom - 32);
  const result = { shape, top, bottom: b.bottom, fx, fy, s, seat, neck, hull };
  anchorCache.set(shape, result);
  return result;
}

const polygon = (points) => `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;
const polyline = (points) => `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`;

const sweepLine = (left, right, y, sag) => `M${n(left)} ${n(y)}Q${n((left + right) / 2)} ${n(y + sag * 2)} ${n(right)} ${n(y)}`;
const ribbon = (left, right, y, sag, thick) => {
  const h = thick / 2;
  const mid = (left + right) / 2;
  return `M${n(left)} ${n(y - h)}Q${n(mid)} ${n(y - h + sag * 2)} ${n(right)} ${n(y - h)}A${n(h)} ${n(h)} 0 0 1 ${n(right)} ${n(y + h)}Q${n(mid)} ${n(y + h + sag * 2)} ${n(left)} ${n(y + h)}A${n(h)} ${n(h)} 0 0 1 ${n(left)} ${n(y - h)}Z`;
};
const above = (y, sag = 0) => `M-170 ${n(y)}Q0 ${n(y + sag * 2)} 170 ${n(y)}V-260H-170Z`;
const band = (y1, y2, sag = 0) => `M-170 ${n(y1)}Q0 ${n(y1 + sag * 2)} 170 ${n(y1)}V${n(y2)}Q0 ${n(y2 + sag * 2)} -170 ${n(y2)}Z`;
const ball = (x, y, r, fill) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}"/>`;

function clay(id) {
  return {
    main: `url(#${id}-a)`,
    deep: `url(#${id}-k)`,
    cream: `url(#${id}-c)`,
    shine: (x, y, rx, ry, rot = 0) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" transform="rotate(${rot} ${n(x)} ${n(y)})" fill="url(#${id}-h)"/>`,
    clip: (grow) => `url(#${id}-o${grow})`,
  };
}

const LEAF = "M0 0C5 -9 18 -13 29 -6C21 4 9 6 0 0Z";
const LOOP = "M0 0C-5 -12 -22 -19 -27 -8C-31 2 -24 14 -11 11C-5 9 -2 5 0 0Z";
const WING = "M0 0C-7 -11 -22 -16 -26 -6C-29 4 -24 13 -13 10C-7 8 -3 4 0 0Z";

const at = (x, y, k, rot = 0) => `translate(${n(x)} ${n(y)})${rot ? ` rotate(${rot})` : ""} scale(${k})`;

const BUILD = {
  sprout(a, c) {
    const y = a.top + 6;
    const k = 1.8;
    const front = `<g transform="${at(0, y, k)}"><path d="M0 2Q-3 -8 1 -17" fill="none" stroke="${c.deep}" stroke-width="4.5" stroke-linecap="round"/><g transform="translate(1 -16)"><path d="${LEAF}" transform="rotate(-28) scale(1.15)" fill="${c.main}"/><path d="${LEAF}" transform="scale(-1 1) rotate(-12) scale(.9)" fill="${c.main}"/>${c.shine(12, -12, 7, 2.6, -28)}${c.shine(-10, -5, 5, 2, 12)}</g></g>`;
    return { front, contact: `<ellipse cx="0" cy="${n(y + 1)}" rx="9" ry="5" fill="#000"/>`, top: y - 36 * k, sway: [0, y + 2] };
  },
  flower(a, c) {
    const [px, py] = pointAt(body(a.shape).points, -52, [a.fx, a.fy - 12 * a.s], 7);
    const k = 1.45;
    const petals = [0, 72, 144, 216, 288]
      .map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        const x = n(Math.cos(rad) * 10);
        const y = n(Math.sin(rad) * 10);
        return `<ellipse cx="${x}" cy="${y}" rx="8.5" ry="10" transform="rotate(${deg} ${x} ${y})" fill="${c.main}"/>`;
      })
      .join("");
    const front = `<g transform="${at(px, py, k, 14)}">${petals}${c.shine(-7, -13, 4, 2.4, -30)}${ball(0, 0, 7.5, c.cream)}${c.shine(-2.5, -2.5, 2.6, 1.8)}</g>`;
    return { front, contact: ball(px, py, 16 * k, "#000"), top: py - 21 * k, side: Math.abs(px) + 21 * k };
  },
  bow(a, c) {
    const [px, py] = pointAt(body(a.shape).points, -126, [a.fx, a.fy - 12 * a.s], 5);
    const k = 1.45;
    const front = `<g transform="${at(px, py, k, -22)}"><path d="${LOOP}" fill="${c.main}"/><path d="${LOOP}" transform="scale(-1 1)" fill="${c.main}"/>${c.shine(-17, -8, 6, 3, -30)}${c.shine(12, -9, 5, 2.4, 30)}<rect x="-6.5" y="-8" width="13" height="16" rx="6.5" fill="${c.deep}"/>${c.shine(-2, -3.5, 2.6, 1.6)}</g>`;
    return { front, contact: `<ellipse cx="${n(px)}" cy="${n(py + 3)}" rx="${n(24 * k)}" ry="${n(10 * k)}" transform="rotate(-22 ${n(px)} ${n(py)})" fill="#000"/>`, top: py - 22 * k, side: Math.abs(px) + 30 * k };
  },
  antenna(a, c) {
    const y = a.top + 4;
    const k = 1.45;
    const front = `<g transform="${at(0, y, k)}"><path d="M0 0Q7 -15 2 -28" fill="none" stroke="${c.cream}" stroke-width="4" stroke-linecap="round"/><ellipse cx="0" cy="1" rx="9" ry="5" fill="${c.cream}"/>${ball(2, -35, 15, c.main).replace("/>", ' opacity=".22"/>')}${ball(2, -35, 9.5, c.main)}${c.shine(-1.5, -39, 4, 2.6, -30)}</g>`;
    return { front, contact: `<ellipse cx="0" cy="${n(y + 3)}" rx="13" ry="6" fill="#000"/>`, top: y - 52 * k, sway: [0, y + 2] };
  },
  beanie(a, c) {
    const seat = a.seat;
    const lift = `translate(0 ${n(seat)}) scale(1 1.14) translate(0 ${n(-seat)})`;
    const dome = `<g transform="${lift}"><path d="${above(seat - 8, -2)}" clip-path="${c.clip(7)}" fill="${c.main}"/><g clip-path="${c.clip(7)}">${c.shine(-30, a.top + 14, 24, 11, -24)}</g></g>`;
    const [left, right] = edgesAt(outline(a.shape, 4), seat - 9);
    const cuff = `<path d="${ribbon(left, right, seat - 9, 3, 24)}" fill="${c.deep}"/><path d="${sweepLine(left + 4, right - 4, seat - 16, 3)}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="4" stroke-linecap="round"/>`;
    const knob = a.top - 6 - (a.top - seat) * 0.14;
    const front = `${dome}${cuff}${ball(0, knob - 8, 15, c.main)}${c.shine(-6, knob - 14, 6, 4, -30)}`;
    return { front, contact: `<path d="${sweepLine(left, right, seat + 2, 3)}" stroke="#000" stroke-width="10" stroke-linecap="round" fill="none"/>`, top: knob - 24, side: Math.max(right, -left) + 12 };
  },
  cap(a, c) {
    const seat = a.seat + 2;
    const [, right] = edgesAt(outline(a.shape, 5), seat - 3);
    const lift = `translate(0 ${n(seat)}) scale(1 1.08) translate(0 ${n(-seat)})`;
    const dome = `<g transform="${lift}"><path d="${above(seat, -3)}" clip-path="${c.clip(5)}" fill="${c.main}"/><g clip-path="${c.clip(5)}">${c.shine(-30, a.top + 14, 24, 10, -24)}</g><path d="M0 ${n(a.top - 4)}Q${n(-right * 0.3)} ${n((a.top + seat) / 2)} ${n(-right * 0.16)} ${n(seat - 2)}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="2.5" stroke-linecap="round" clip-path="${c.clip(5)}"/></g>`;
    const brim = `<path d="M${n(right * 0.1)} ${n(seat - 9)}Q${n(right + 34)} ${n(seat - 14)} ${n(right + 40)} ${n(seat + 1)}Q${n(right + 28)} ${n(seat + 11)} ${n(right * 0.1)} ${n(seat + 3)}Z" fill="${c.deep}" stroke="${c.deep}" stroke-width="4" stroke-linejoin="round"/>${c.shine(right + 6, seat - 6, 16, 3, -4)}`;
    const front = `${dome}${brim}${ball(0, a.top - 5, 7, c.deep)}`;
    return { front, contact: `<path d="${band(seat - 4, seat + 6, -3)}" clip-path="${c.clip(5)}" fill="#000"/>`, top: a.top - 14, side: right + 44 };
  },
  party(a, c) {
    const y = a.top + 16;
    const k = 1.4;
    const cone = "M-25 0Q0 9 25 0L3.5 -58Q0 -62 -3.5 -58Z";
    const defs = `<clipPath id="CONE"><path d="${cone}"/></clipPath>`;
    const front = `<g transform="${at(10, y, k, 12)}"><path d="${cone}" fill="${c.main}" stroke="${c.main}" stroke-width="4" stroke-linejoin="round"/><g clip-path="url(#CONE)" opacity=".75"><path d="${band(-21, -13, 1.5)}" fill="${c.cream}"/><path d="${band(-41, -34, 0.8)}" fill="${c.cream}"/></g>${c.shine(-8, -26, 4, 12, 10)}${ball(0, -62, 9, c.cream)}${c.shine(-3, -65, 3.4, 2.4, -30)}</g>`;
    return { defs, front, contact: `<ellipse cx="10" cy="${n(y + 3)}" rx="${n(26 * k)}" ry="9" fill="#000"/>`, top: y - 70 * k };
  },
  crown(a, c) {
    const y = a.top + 17;
    const k = 1.3;
    const shape = "M-33 0L-39 -32L-19 -15L0 -40L19 -15L39 -32L33 0Q0 -7 -33 0Z";
    const tips = [[-39, -34], [0, -42], [39, -34]].map(([x, ty]) => ball(x, ty, 5.5, c.cream)).join("");
    const front = `<g transform="${at(0, y, k)}"><path d="${shape}" fill="${c.main}" stroke="${c.main}" stroke-width="6" stroke-linejoin="round"/>${c.shine(-20, -12, 8, 4, -20)}${tips}<ellipse cx="0" cy="-11" rx="6.5" ry="7.5" fill="${c.deep}"/>${c.shine(-1.5, -13.5, 2.4, 1.8)}</g>`;
    return { front, contact: `<path d="M${n(-36 * k)} ${n(y)}Q0 ${n(y - 8)} ${n(36 * k)} ${n(y)}Q0 ${n(y + 6)} ${n(-36 * k)} ${n(y)}Z" fill="#000"/>`, top: y - 48 * k };
  },
  headphones(a, c) {
    const cupY = a.fy - 2;
    const sweep = ([x, y]) => {
      const angle = Math.atan2(y, x);
      return angle > Math.PI / 2 ? angle - Math.PI * 2 : angle;
    };
    const arc = outline(a.shape, 11)
      .filter(([, y]) => y < cupY - 14)
      .sort((p, q) => sweep(p) - sweep(q));
    const [left, right] = edgesAt(a.hull, cupY);
    const cup = (x, flip) =>
      `<g transform="translate(${n(x)} ${n(cupY)})${flip ? " scale(-1 1)" : ""}"><rect x="-13" y="-20" width="12" height="40" rx="6" fill="${c.deep}"/><rect x="-5" y="-26" width="25" height="52" rx="12.5" fill="${c.main}"/>${c.shine(3, -14, 4.5, 8, 8)}</g>`;
    const back = `<path d="${polyline(arc)}" fill="none" stroke="${c.main}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`;
    const front = `${cup(right - 1, false)}${cup(left + 1, true)}`;
    const contact = `<ellipse cx="${n(right - 8)}" cy="${n(cupY + 4)}" rx="10" ry="24" fill="#000"/><ellipse cx="${n(left + 8)}" cy="${n(cupY + 4)}" rx="10" ry="24" fill="#000"/>`;
    return { back, front, contact, top: a.top - 17, side: Math.max(right, -left) + 21, gaze: [2.5, 1.5] };
  },
  glasses(a, c) {
    const g = 27 * a.s;
    const r = 20.5 * a.s;
    const y = a.fy;
    const lens = (x) =>
      `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="#fff" fill-opacity=".12"/><path d="M${n(x - r * 0.6)} ${n(y - r * 0.18)}A${n(r * 0.62)} ${n(r * 0.62)} 0 0 1 ${n(x - r * 0.1)} ${n(y - r * 0.6)}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3.5" stroke-linecap="round"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke="${c.main}" stroke-width="8"/>`;
    const arms = `<path d="M${n(-g - r - 2)} ${n(y - 4)}h-9M${n(g + r + 2)} ${n(y - 4)}h9" stroke="${c.deep}" stroke-width="6" stroke-linecap="round"/>`;
    const bridge = `<path d="M${n(-g + r)} ${n(y - 3)}Q0 ${n(y - 12)} ${n(g - r)} ${n(y - 3)}" fill="none" stroke="${c.main}" stroke-width="6.5" stroke-linecap="round"/>`;
    const front = `${arms}${lens(-g)}${lens(g)}${bridge}${c.shine(-g - r * 0.6, y - r * 0.72, 5, 2.6, -40)}${c.shine(g - r * 0.6, y - r * 0.72, 5, 2.6, -40)}`;
    const contact = `<circle cx="${n(-g)}" cy="${n(y + 2)}" r="${n(r + 2)}" fill="none" stroke="#000" stroke-width="7"/><circle cx="${n(g)}" cy="${n(y + 2)}" r="${n(r + 2)}" fill="none" stroke="#000" stroke-width="7"/>`;
    return { front, contact, top: y - r, gaze: [6 * a.s, 4] };
  },
  scarf(a, c) {
    const y = a.neck + 12;
    const [left, right] = edgesAt(outline(a.shape, 2), y);
    const tx = right * 0.42;
    const wrap = `<path d="${ribbon(left, right, y, 5, 27)}" fill="${c.main}"/><path d="${sweepLine(left * 0.82, right * 0.5, y - 8, 5)}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="4" stroke-linecap="round"/>`;
    const tail = `<g transform="translate(${n(tx + 3)} ${n(y + 6)}) rotate(-10)"><rect x="-13" y="-2" width="26" height="44" rx="11" fill="${c.main}"/>${c.shine(-5, 9, 4, 11)}<path d="M-8 41V48M0 41V49M8 41V48" stroke="${c.deep}" stroke-width="4.5" stroke-linecap="round"/></g>`;
    const knot = `${ball(tx + 1, y + 1, 13, c.deep)}${c.shine(tx - 3, y - 3, 5, 3.2)}`;
    return { front: `${wrap}${tail}${knot}`, contact: `<path d="${sweepLine(left, right, y + 8, 5)}" fill="none" stroke="#000" stroke-width="18" stroke-linecap="round"/>`, top: y - 14, side: Math.max(right, -left) + 14 };
  },
  bowtie(a, c) {
    const y = Math.min(a.fy + 58 * a.s, a.bottom - 20);
    const k = 1.5;
    const front = `<g transform="${at(a.fx, y, k)}"><path d="${WING}" fill="${c.main}"/><path d="${WING}" transform="scale(-1 1)" fill="${c.main}"/>${c.shine(-16, -6, 5, 2.6, -25)}${c.shine(12, -7, 4, 2.2, 25)}<rect x="-6" y="-7" width="12" height="14" rx="5.5" fill="${c.deep}"/>${c.shine(-2, -3, 2.4, 1.6)}</g>`;
    return { front, contact: `<ellipse cx="${n(a.fx)}" cy="${n(y + 5)}" rx="${n(26 * k)}" ry="${n(9 * k)}" fill="#000"/>`, top: y - 14 * k };
  },
};

const partCache = new Map();

function build(spec) {
  const acc = ACCESSORIES.includes(spec.acc) ? spec.acc : "none";
  if (acc === "none") return null;
  const a = anchors(SHAPES.includes(spec.shape) ? spec.shape : "circle");
  const key = `${a.shape}:${acc}`;
  const hit = partCache.get(key);
  if (hit) return hit;
  const out = BUILD[acc](a, clay("ID"));
  const result = { ...out, acc, a };
  partCache.set(key, result);
  return result;
}

export function accessoryFit(spec) {
  const part = build(spec);
  if (!part) return 1;
  const ground = part.a.bottom;
  const room = Math.min(1, (ground + 122) / (ground - part.top), part.side ? 124 / part.side : 1);
  return Math.max(0.78, room);
}

export function accessoryTransform(spec, pose) {
  const part = build(spec);
  if (!part) return "";
  const gx = Math.max(-1, Math.min(1, pose.gx));
  const gy = Math.max(-1, Math.min(1, pose.gy));
  if (part.gaze) return `translate(${n(gx * part.gaze[0])} ${n(gy * part.gaze[1])})`;
  if (part.sway) {
    const angle = -pose.tilt * 0.9 - gx * 7 + (pose.sy - 1) * 60 + pose.lift * 0.35;
    return `rotate(${n(angle)} ${n(part.sway[0])} ${n(part.sway[1])})`;
  }
  return "";
}

export function accessory(spec, id = "f") {
  const part = build(spec);
  if (!part) return null;
  const key = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  const t = tones(spec.accColor ?? accessoryColor(part.acc, spec.color));
  const deep = tones(t.dark);
  const cream = tones(CREAM);
  const stops = (tone) => `<stop offset="0" stop-color="${tone.light}"/><stop offset=".3" stop-color="${tone.mid}"/><stop offset=".68" stop-color="${tone.base}"/><stop offset="1" stop-color="${tone.dark}"/>`;
  const grad = (suffix, tone) => `<radialGradient id="${key}-${suffix}" cx=".34" cy=".26" r=".95">${stops(tone)}</radialGradient>`;
  const clips = [5, 6, 7, 11]
    .filter((grow) => [part.front, part.back, part.contact].some((layer) => layer?.includes(`ID-o${grow})`)))
    .map((grow) => `<clipPath id="${key}-o${grow}"><path d="${polygon(outline(part.a.shape, grow))}"/></clipPath>`)
    .join("");
  const defs = `${grad("a", t)}${grad("k", { ...deep, light: t.mid, mid: t.base })}${grad("c", cream)}<radialGradient id="${key}-h"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><filter id="${key}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter><clipPath id="${key}-body"><path d="${body(part.a.shape).d}"/></clipPath>${clips}${part.defs ?? ""}`;
  const local = (markup) => (markup ? markup.replaceAll("url(#ID-", `url(#${key}-`).replaceAll('id="CONE"', `id="${key}-cone"`).replaceAll("url(#CONE)", `url(#${key}-cone)`) : "");
  const shadow = part.contact ? `<g clip-path="url(#${key}-body)" opacity=".26"><g filter="url(#${key}-soft)" transform="translate(1 5)">${local(part.contact)}</g></g>` : "";
  return { defs: local(defs), back: local(part.back), front: `${shadow}${local(part.front)}` };
}
