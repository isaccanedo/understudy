import type { AgentState } from "@understudy/protocol";

export type Pose = { gx: number; gy: number; blink: number; sx: number; sy: number; lift: number; tilt: number };

export type Actor = {
  state: AgentState;
  rest: [number, number];
  element: () => HTMLElement | null;
  apply: (pose: Pose) => void;
  poke: { at: number; kind: "squish" | "hop" } | null;
  seed: number;
};

const actors = new Set<Actor>();
const pointer = { x: 0, y: 0, at: -1e9 };
let frame = 0;
let last = 0;
let listening = false;

type Memory = { gx: number; gy: number; target: [number, number]; nextGlance: number; nextBlink: number; blinkAt: number; rect: DOMRect | null; rectAt: number; visible: boolean };
const memory = new WeakMap<Actor, Memory>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wave = (t: number, speed: number, phase = 0) => Math.sin(t * speed + phase);

function remember(actor: Actor): Memory {
  let m = memory.get(actor);
  if (!m) {
    m = { gx: actor.rest[0], gy: actor.rest[1], target: actor.rest, nextGlance: 0, nextBlink: 1 + actor.seed * 3, blinkAt: -1, rect: null, rectAt: -1, visible: true };
    memory.set(actor, m);
  }
  return m;
}

function hop(phase: number, height: number) {
  if (phase < 0.18) {
    const k = phase / 0.18;
    return { lift: 0, sy: 1 - 0.14 * Math.sin(k * Math.PI * 0.5) };
  }
  if (phase < 0.62) {
    const k = (phase - 0.18) / 0.44;
    return { lift: -height * Math.sin(k * Math.PI), sy: 1 + 0.1 * Math.sin(k * Math.PI) - 0.04 };
  }
  if (phase < 0.78) {
    const k = (phase - 0.62) / 0.16;
    return { lift: 0, sy: 1 - 0.12 * Math.sin(k * Math.PI) };
  }
  const k = (phase - 0.78) / 0.22;
  return { lift: 0, sy: 1 + 0.03 * Math.sin(k * Math.PI * 2) * (1 - k) };
}

function look(actor: Actor, m: Memory, t: number): [number, number] {
  const pointerFresh = t * 1000 - pointer.at < 3500;
  const watchesPointer = actor.state === "calm" || actor.state === "listening" || actor.state === "waiting_you" || actor.state === "done";
  if (pointerFresh && watchesPointer && m.rect) {
    const cx = m.rect.left + m.rect.width / 2;
    const cy = m.rect.top + m.rect.height / 2;
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    const distance = Math.hypot(dx, dy) || 1;
    const reach = distance / (distance + 120);
    return [clamp((dx / distance) * reach, -1, 1), clamp((dy / distance) * reach, -1, 1)];
  }
  const s = actor.seed * 10;
  switch (actor.state) {
    case "working": {
      const line = (t * 0.9 + s) % 1;
      const row = Math.floor((t * 0.9 + s) % 4);
      return [-0.65 + line * 1.3, 0.1 + row * 0.12];
    }
    case "thinking":
      return [0.55 + wave(t, 0.7, s) * 0.12, -0.7 + wave(t, 1.1, s) * 0.08];
    case "stuck":
      return [wave(t, 0.5, s) * 0.5, 0.45];
    default:
      if (t > m.nextGlance) {
        const quiet = Math.random() < 0.45;
        m.target = quiet ? actor.rest : [clamp(actor.rest[0] + (Math.random() - 0.5) * 1.3, -0.8, 0.8), clamp(actor.rest[1] + (Math.random() - 0.5) * 0.9, -0.6, 0.6)];
        m.nextGlance = t + 1.2 + Math.random() * 3.2;
      }
      return m.target;
  }
}

function body(actor: Actor, t: number): Pick<Pose, "sx" | "sy" | "lift" | "tilt"> {
  const s = actor.seed * 10;
  let sy = 1;
  let lift = 0;
  let tilt = 0;
  switch (actor.state) {
    case "calm":
      sy = 1 + wave(t, 1.6, s) * 0.022;
      tilt = wave(t, 0.45, s) * 1.5;
      break;
    case "working": {
      const beat = Math.abs(wave(t, 7, s));
      sy = 1 - beat * 0.035;
      lift = -beat * 2.5;
      tilt = wave(t, 1.3, s) * 2;
      break;
    }
    case "thinking":
      sy = 1 + wave(t, 1.2, s) * 0.02;
      tilt = wave(t, 0.9, s) * 7;
      break;
    case "listening":
      sy = 1 + wave(t, 1.4, s) * 0.02;
      tilt = -8 + wave(t, 2.2, s) * 2.5;
      break;
    case "waiting_you": {
      const cycle = (t / 1.9 + actor.seed) % 1;
      const jump = cycle < 0.55 ? hop(cycle / 0.55, 22) : { lift: 0, sy: 1 + wave(t, 2, s) * 0.015 };
      sy = jump.sy;
      lift = jump.lift;
      tilt = cycle < 0.55 ? wave(cycle * 12, 1) * 4 : 0;
      break;
    }
    case "done": {
      const cycle = (t / 3.6 + actor.seed) % 1;
      if (cycle < 0.3) {
        const jump = hop(cycle / 0.3, 14);
        sy = jump.sy;
        lift = jump.lift;
        tilt = wave(cycle * 40, 1) * 6 * (1 - cycle / 0.3);
      } else {
        sy = 1 + wave(t, 1.6, s) * 0.02;
      }
      break;
    }
    case "stuck":
      sy = 0.95 + wave(t, 0.9, s) * 0.012;
      tilt = 9 + wave(t, 0.6, s) * 2 + (wave(t, 31, s) > 0.97 ? 2.5 : 0);
      break;
  }
  return { sx: 1 / Math.sqrt(sy), sy, lift, tilt };
}

function blink(actor: Actor, m: Memory, t: number) {
  if (actor.state === "stuck" || actor.state === "thinking") {
    if (t > m.nextBlink) {
      m.blinkAt = t;
      m.nextBlink = t + 2.5 + Math.random() * 3;
    }
  } else if (t > m.nextBlink) {
    m.blinkAt = t;
    m.nextBlink = t + (Math.random() < 0.2 ? 0.28 : 2 + Math.random() * 3.5);
  }
  const since = t - m.blinkAt;
  const length = actor.state === "stuck" ? 0.42 : 0.17;
  if (since < 0 || since > length) return 0;
  return Math.sin((since / length) * Math.PI);
}

function poke(actor: Actor, t: number, pose: Pose) {
  if (!actor.poke) return pose;
  const since = t - actor.poke.at;
  if (actor.poke.kind === "hop") {
    if (since > 0.75) {
      actor.poke = null;
      return pose;
    }
    const jump = hop(since / 0.75, 26);
    return { ...pose, lift: pose.lift + jump.lift, sy: pose.sy * jump.sy, sx: pose.sx / jump.sy };
  }
  if (since > 0.9) {
    actor.poke = null;
    return pose;
  }
  const jelly = Math.exp(-since * 5.5) * Math.sin(since * 26) * 0.11;
  return { ...pose, sy: pose.sy * (1 - jelly), sx: pose.sx * (1 + jelly) };
}

function tick(now: number) {
  frame = 0;
  const t = now / 1000;
  const dt = Math.min(0.05, last ? t - last : 0.016);
  last = t;
  for (const actor of actors) {
    const m = remember(actor);
    if (!m.visible) continue;
    if (now - m.rectAt > 400) {
      m.rect = actor.element()?.getBoundingClientRect() ?? null;
      m.rectAt = now;
    }
    const [tx, ty] = look(actor, m, t);
    const speed = Math.min(1, dt * 14);
    m.gx += (tx - m.gx) * speed;
    m.gy += (ty - m.gy) * speed;
    actor.apply(poke(actor, t, { gx: m.gx, gy: m.gy, blink: blink(actor, m, t), ...body(actor, t) }));
  }
  if (actors.size) frame = requestAnimationFrame(tick);
}

function onPointer(event: PointerEvent) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.at = performance.now();
}

const observer =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((entries) => {
        for (const entry of entries) {
          for (const actor of actors) {
            if (actor.element() === entry.target) remember(actor).visible = entry.isIntersecting;
          }
        }
      });

export function reducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function join(actor: Actor) {
  actors.add(actor);
  const element = actor.element();
  if (element) observer?.observe(element);
  if (!listening) {
    addEventListener("pointermove", onPointer, { passive: true });
    listening = true;
  }
  if (!frame) frame = requestAnimationFrame(tick);
  return () => {
    actors.delete(actor);
    if (element) observer?.unobserve(element);
    if (!actors.size) {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      removeEventListener("pointermove", onPointer);
      listening = false;
    }
  };
}
