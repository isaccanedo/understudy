export type SelectOption = { value: string; label: string; description?: string; meta?: string; disabled?: boolean };

export type SelectIntent =
  | { type: "open"; to: "selected" | "first" | "last" }
  | { type: "close" }
  | { type: "commit"; thenClose: true; keepDefault?: boolean }
  | { type: "move"; by: number }
  | { type: "edge"; to: "first" | "last" }
  | { type: "type"; char: string }
  | null;

export function enabledIndex(options: SelectOption[], from: number, step: 1 | -1): number {
  for (let index = from; index >= 0 && index < options.length; index += step) {
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function moveIndex(options: SelectOption[], current: number, by: number): number {
  if (options.length === 0) return -1;
  const step = by > 0 ? 1 : -1;
  let target = current < 0 ? (step > 0 ? -1 : options.length) : current;
  let moved = current;
  for (let left = Math.abs(by); left > 0; left -= 1) {
    const next = enabledIndex(options, target + step, step);
    if (next === -1) break;
    target = next;
    moved = next;
  }
  return moved === -1 ? edgeIndex(options, step > 0 ? "first" : "last") : moved;
}

export function edgeIndex(options: SelectOption[], edge: "first" | "last"): number {
  return edge === "first" ? enabledIndex(options, 0, 1) : enabledIndex(options, options.length - 1, -1);
}

export function selectedIndex(options: SelectOption[], value: string | undefined): number {
  const found = options.findIndex((option) => option.value === value && !option.disabled);
  return found === -1 ? edgeIndex(options, "first") : found;
}

export function typeahead(options: SelectOption[], query: string, current: number): number {
  const wanted = query.toLocaleLowerCase();
  if (!wanted) return current;
  const repeated = wanted.split("").every((char) => char === wanted[0]);
  const start = wanted.length === 1 || repeated ? current + 1 : Math.max(current, 0);
  const matches = (option: SelectOption, text: string) => !option.disabled && option.label.toLocaleLowerCase().startsWith(text);
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (start + offset + options.length) % options.length;
    if (matches(options[index], wanted)) return index;
  }
  if (repeated) {
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset + options.length) % options.length;
      if (matches(options[index], wanted[0])) return index;
    }
  }
  return current;
}

export function keyIntent(event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }, open: boolean, typing: boolean): SelectIntent {
  const { key } = event;
  const printable = key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (!open) {
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") return { type: "open", to: "selected" };
    if (key === "Home") return { type: "open", to: "first" };
    if (key === "End") return { type: "open", to: "last" };
    if (printable) return { type: "type", char: key };
    return null;
  }
  if (key === "ArrowDown") return event.altKey ? null : { type: "move", by: 1 };
  if (key === "ArrowUp") return event.altKey ? { type: "commit", thenClose: true } : { type: "move", by: -1 };
  if (key === "PageDown") return { type: "move", by: 10 };
  if (key === "PageUp") return { type: "move", by: -10 };
  if (key === "Home") return { type: "edge", to: "first" };
  if (key === "End") return { type: "edge", to: "last" };
  if (key === "Escape") return { type: "close" };
  if (key === "Enter") return { type: "commit", thenClose: true };
  if (key === " " && !typing) return { type: "commit", thenClose: true };
  if (key === "Tab") return { type: "commit", thenClose: true, keepDefault: true };
  if (printable) return { type: "type", char: key };
  return null;
}

export type Rect = { top: number; bottom: number; left: number; width: number };

export type Placement = { side: "below" | "above"; top: number; left: number; width: number; maxHeight: number };

export function placePopup({
  trigger,
  viewport,
  listHeight,
  gap = 6,
  margin = 8,
  minWidth = 200,
  maxHeight = 320,
}: {
  trigger: Rect;
  viewport: { width: number; height: number };
  listHeight: number;
  gap?: number;
  margin?: number;
  minWidth?: number;
  maxHeight?: number;
}): Placement {
  const room = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(Math.max(trigger.width, minWidth), room);
  const left = Math.min(Math.max(trigger.left, margin), viewport.width - margin - width);
  const below = viewport.height - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const wanted = Math.min(listHeight, maxHeight);
  const side = below >= wanted || below >= above ? "below" : "above";
  const space = side === "below" ? below : above;
  const height = Math.max(Math.min(wanted, space), Math.min(wanted, 120));
  const top = side === "below" ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - height);
  return { side, top, left: Math.max(margin, left), width, maxHeight: height };
}
