import { accessoryColor, ACCESSORIES as ACCESSORY_NAMES, COLORS as PALETTE, FACES as FACE_NAMES, SHAPES } from "@understudy/characters";

export type Look = {
  body: string;
  color: string;
  eyes: string;
  acc: string;
  accColor: string;
};

export const BODIES = [...SHAPES];
export const EYES = [...FACE_NAMES];
export const COLORS = [...PALETTE];
export const ACCESSORIES = [...ACCESSORY_NAMES];
export { accessoryColor };

export const DEFAULT_LOOK: Look = { body: "cloud", color: COLORS[1], eyes: "neutral", acc: "none", accColor: accessoryColor("none", COLORS[1]) };

const OLD_BODIES: Record<string, string> = { bean: "pebble", pear: "droplet", tri: "triangle", blob: "pebble", square: "squircle", drop: "droplet", pill: "capsule" };
const OLD_ACCESSORIES: Record<string, string> = { beret: "beanie", ears: "none" };
const OLD_ACCENTS: Record<string, string> = {
  "#2F3A56": "#5B6472",
  "#E8554E": "#EF5350",
  "#3D7BE0": "#3B93F0",
  "#2F9E6E": "#3ECF8E",
  "#C98A1E": "#F5C33B",
  "#8A5CD6": "#8B6CF6",
};
const OLD_EYES: Record<string, string> = { dot: "attentive", slit: "neutral", diamond: "curious" };
const OLD_COLORS: Record<string, string> = {
  "#FF8A7A": "#EF5350",
  "#7FB2FF": "#3B93F0",
  "#6FD6A4": "#3ECF8E",
  "#F6C26B": "#F5C33B",
  "#C3A2FF": "#8B6CF6",
  "#F59BC8": "#F25C8A",
  "#9AD7E6": "#2EC4C6",
  "#D9D2C5": "#E9E6DF",
};

function pick<T>(list: T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

export function cleanLook(input: Partial<Look> | null | undefined): Look {
  const body = typeof input?.body === "string" ? (OLD_BODIES[input.body] ?? input.body) : undefined;
  const eyes = typeof input?.eyes === "string" ? (OLD_EYES[input.eyes] ?? input.eyes) : undefined;
  const color = typeof input?.color === "string" ? (OLD_COLORS[input.color.toUpperCase()] ?? input.color.toUpperCase()) : undefined;
  const acc = typeof input?.acc === "string" ? (OLD_ACCESSORIES[input.acc] ?? input.acc) : undefined;
  const accColor = typeof input?.accColor === "string" ? (OLD_ACCENTS[input.accColor.toUpperCase()] ?? input.accColor.toUpperCase()) : undefined;
  const clean = {
    body: pick(BODIES, body, DEFAULT_LOOK.body),
    color: pick(COLORS, color, DEFAULT_LOOK.color),
    eyes: pick(EYES, eyes, DEFAULT_LOOK.eyes),
    acc: pick(ACCESSORIES, acc, DEFAULT_LOOK.acc),
  };
  return { ...clean, accColor: pick(COLORS, accColor, accessoryColor(clean.acc, clean.color)) };
}

const RESTING_FACES = ["neutral", "attentive", "curious", "happy", "proud", "suspicious", "shy", "unimpressed", "excited"];

export function randomLook(seed = Math.random()): Look {
  const at = <T,>(list: T[], n: number) => list[Math.floor(n * list.length) % list.length];
  const color = at(COLORS, (seed * 7) % 1);
  const acc = (seed * 17) % 1 < 0.4 ? "none" : at(ACCESSORIES.slice(1), (seed * 23) % 1);
  return {
    body: at(BODIES, seed),
    color,
    eyes: at(RESTING_FACES, (seed * 13) % 1),
    acc,
    accColor: accessoryColor(acc, color),
  };
}
