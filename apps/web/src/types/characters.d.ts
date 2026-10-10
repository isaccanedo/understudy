declare module "@understudy/characters" {
  export type FigureSpec = { shape: string; color: string; face: string; acc?: string; accColor?: string };
  export type FigurePose = { gx: number; gy: number; blink: number; sx: number; sy: number; lift: number; tilt: number };
  export type FigureMark = { d: string; x: number; y?: number; rot?: number; stroke?: number; side: "left" | "right" | "mouth" };
  export type FigureFace = { eyes: Omit<FigureMark, "side">[]; mouth?: Omit<FigureMark, "side" | "x"> & { x?: number }; blush?: boolean; look?: [number, number] };
  export type FigureBody = { d: string; top: number; bottom: number; width: number; face: [number, number, number] };
  export const SHAPES: string[];
  export const FACES: string[];
  export const COLORS: string[];
  export const ACCESSORIES: string[];
  export function accessoryColor(acc: string, bodyColor: string): string;
  export function accessory(spec: FigureSpec, id?: string | number): { defs: string; back: string; front: string } | null;
  export function accessoryTransform(spec: FigureSpec, pose: FigurePose): string;
  export function accessoryFit(spec: FigureSpec): number;
  export const REST: FigurePose;
  export function body(shape: string): FigureBody;
  export function face(name: string): FigureFace;
  export function tones(color: string): { light: string; mid: string; base: string; dark: string };
  export function parts(spec: FigureSpec): { shape: FigureBody; look: FigureFace; marks: FigureMark[]; tones: { light: string; mid: string; base: string; dark: string }; viewBox: string };
  export function eyeTransform(spec: FigureSpec, mark: FigureMark, side: FigureMark["side"], pose: FigurePose): string;
  export function bodyTransform(spec: FigureSpec, pose: FigurePose): string;
  export function shadowTransform(spec: FigureSpec, pose: FigurePose): string;
  export function figure(spec: FigureSpec, id?: string | number, pose?: Partial<FigurePose>): string;
}
