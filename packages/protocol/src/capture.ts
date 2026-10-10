import { SENSITIVE_LABEL } from "./patterns.ts";
import type { RecordedEventSchema } from "./schemas.ts";
import type { z } from "zod";

type RecordedEvent = z.infer<typeof RecordedEventSchema>;

export const RECORD_BINDING = "__understudyRecord";
export const RECORDER_SWITCH = "__understudyRecorderOn";

export const SENSITIVE_AUTOCOMPLETE = /(password|one-time-code|cc-number|cc-csc|cc-exp|cc-name|cc-type)/i;

export function captureScript(): string {
  return `(${installCapture.toString()})(${JSON.stringify(RECORD_BINDING)}, ${JSON.stringify(RECORDER_SWITCH)}, ${JSON.stringify(SENSITIVE_LABEL.source)}, ${JSON.stringify(SENSITIVE_AUTOCOMPLETE.source)});`;
}

export function installCapture(bindingName: string, switchName: string, labelSource: string, autocompleteSource: string) {
  const w = window as unknown as Record<string, unknown>;
  w[switchName] = true;
  if (w.__understudyRecorderInstalled) return;
  w.__understudyRecorderInstalled = true;

  const SECRET_AUTOCOMPLETE = new RegExp(autocompleteSource, "i");
  const SECRET_LABEL = new RegExp(labelSource, "i");
  const pending = new Map<Element, ReturnType<typeof setTimeout>>();

  const emit = (payload: Record<string, unknown>) => {
    if (!w[switchName]) return;
    const binding = w[bindingName] as ((value: string) => void) | undefined;
    if (typeof binding !== "function") return;
    try {
      binding(JSON.stringify({ ...payload, url: location.href, at: Date.now() }));
    } catch {}
  };

  const clean = (text: string | null | undefined, max = 80) => {
    const flat = (text || "").replace(/\s+/g, " ").trim();
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
  };

  const cssEscape = (value: string) =>
    typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  const unique = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const looksGenerated = (value: string) => /\d{3,}|[a-f0-9]{8,}|^:r|^radix-|^headlessui-|^ember\d|^react-/i.test(value);

  const labelOf = (element: Element): string => {
    const aria = element.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      if (clean(text)) return clean(text);
    }
    const field = element as HTMLInputElement;
    if (field.labels && field.labels.length) {
      const text = clean(field.labels[0].textContent);
      if (text) return text;
    }
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return clean(placeholder);
    const tag = element.tagName.toLowerCase();
    if (tag === "input" && ["submit", "button"].includes(field.type) && field.value) return clean(field.value);
    const text = clean((element as HTMLElement).innerText || element.textContent);
    if (text) return text;
    const title = element.getAttribute("title") || element.getAttribute("alt");
    if (title) return clean(title);
    const image = element.querySelector("img[alt], svg[aria-label]");
    if (image) return clean(image.getAttribute("alt") || image.getAttribute("aria-label"));
    const name = element.getAttribute("name");
    if (name) return clean(name);
    return tag;
  };

  const pathSelector = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      if (current.id && !looksGenerated(current.id)) {
        parts.unshift(`#${cssEscape(current.id)}`);
        break;
      }
      const parent: Element | null = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
      current = parent;
      const candidate = parts.join(" > ");
      if (unique(candidate)) return candidate;
    }
    return parts.join(" > ");
  };

  const selectorOf = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    for (const attribute of ["data-testid", "data-test", "data-cy", "data-qa"]) {
      const value = element.getAttribute(attribute);
      if (value) {
        const selector = `[${attribute}="${cssEscape(value)}"]`;
        if (unique(selector)) return selector;
      }
    }
    if (element.id && !looksGenerated(element.id)) {
      const selector = `#${cssEscape(element.id)}`;
      if (unique(selector)) return selector;
    }
    const name = element.getAttribute("name");
    if (name) {
      const selector = `${tag}[name="${cssEscape(name)}"]`;
      if (unique(selector)) return selector;
    }
    const aria = element.getAttribute("aria-label");
    if (aria) {
      const selector = `${tag}[aria-label="${cssEscape(aria)}"]`;
      if (unique(selector)) return selector;
    }
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      const selector = `${tag}[placeholder="${cssEscape(placeholder)}"]`;
      if (unique(selector)) return selector;
    }
    const role = element.getAttribute("role") || (["button", "a"].includes(tag) ? (tag === "a" ? "link" : "button") : "");
    const text = clean((element as HTMLElement).innerText, 50);
    if (role && text && !text.includes('"')) return `role=${role}[name="${text}"]`;
    return pathSelector(element);
  };

  const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], [role=checkbox], [role=radio], [role=switch], [onclick], [contenteditable=true]";

  const targetOf = (node: EventTarget | null): Element | null => {
    if (!(node instanceof Element)) return null;
    return node.closest(INTERACTIVE) || node;
  };

  const isSecret = (element: Element) => {
    const field = element as HTMLInputElement;
    if (field.type === "password") return true;
    if (SECRET_AUTOCOMPLETE.test(element.getAttribute("autocomplete") || "")) return true;
    if (field.type === "search") return false;
    const names = `${element.getAttribute("name") || ""} ${element.id || ""} ${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""} ${labelOf(element)}`;
    return SECRET_LABEL.test(names);
  };

  const valueOf = (element: Element) => {
    if ((element as HTMLElement).isContentEditable) return clean((element as HTMLElement).innerText, 2000);
    return String((element as HTMLInputElement).value ?? "").slice(0, 2000);
  };

  const emitInput = (element: Element) => {
    const masked = isSecret(element);
    emit({
      kind: "input",
      selector: selectorOf(element),
      label: labelOf(element),
      value: masked ? "••••••" : valueOf(element),
      masked,
    });
  };

  const flushInput = (element: Element) => {
    const timer = pending.get(element);
    if (timer === undefined) return;
    clearTimeout(timer);
    pending.delete(element);
    emitInput(element);
  };

  const textual = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if ((element as HTMLElement).isContentEditable) return true;
    if (tag !== "input") return false;
    return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"].includes((element as HTMLInputElement).type);
  };

  document.addEventListener(
    "click",
    (event) => {
      const element = targetOf(event.target);
      if (!element) return;
      if (textual(element)) return;
      if (element.tagName.toLowerCase() === "select") return;
      emit({
        kind: "click",
        selector: selectorOf(element),
        label: labelOf(element),
        x: Math.round((event as MouseEvent).clientX),
        y: Math.round((event as MouseEvent).clientY),
      });
    },
    true,
  );

  document.addEventListener(
    "input",
    (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || !textual(element)) return;
      const previous = pending.get(element);
      if (previous !== undefined) clearTimeout(previous);
      pending.set(element, setTimeout(() => {
        pending.delete(element);
        emitInput(element);
      }, 1200));
    },
    true,
  );

  document.addEventListener(
    "change",
    (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      if (element.tagName.toLowerCase() === "select") {
        const select = element as HTMLSelectElement;
        const option = select.selectedOptions[0];
        emit({
          kind: "select",
          selector: selectorOf(select),
          label: labelOf(select),
          value: clean(option ? option.textContent : select.value, 200),
        });
        return;
      }
      if (textual(element)) flushInput(element);
    },
    true,
  );

  document.addEventListener("blur", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (element) flushInput(element);
  }, true);

  document.addEventListener(
    "keydown",
    (event) => {
      if ((event as KeyboardEvent).key !== "Enter") return;
      const element = event.target instanceof Element ? event.target : null;
      if (element) flushInput(element);
      emit({ kind: "key", key: "Enter" });
    },
    true,
  );

  document.addEventListener(
    "submit",
    () => {
      for (const element of Array.from(pending.keys())) flushInput(element);
    },
    true,
  );
}

export function sanitizeRequestUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const keys = [...new Set([...url.searchParams.keys()])];
    url.search = "";
    url.hash = "";
    return keys.length ? `${url.toString()}?${keys.map((key) => `${key}=…`).join("&")}` : url.toString();
  } catch {
    return raw.split("?")[0];
  }
}

export const MASK = "••••••";

export function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function looksSensitiveValue(value: string): boolean {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[\s.-]/g, "");
  if (/^\d{13,19}$/.test(digits) && passesLuhn(digits)) return true;
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(trimmed)) return true;
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(trimmed)) return true;
  if (/^\d{3}-\d{2}-\d{4}$/.test(trimmed)) return true;
  if (/^(sk|pk|rk|ghp|gho|xox[abpr]|AKIA|eyJ)[A-Za-z0-9_\-.]{10,}$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9_\-]{32,}$/.test(trimmed) && /\d/.test(trimmed) && /[A-Za-z]/.test(trimmed)) return true;
  return false;
}

export function shouldMask(label: string, selector: string, value: string, flagged: boolean): boolean {
  return flagged || SENSITIVE_LABEL.test(label) || SENSITIVE_LABEL.test(selector) || looksSensitiveValue(value);
}

export function parseCaptured(payload: string, now: number = Date.now()): RecordedEvent | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  const url = sanitizeRequestUrl(String(raw.url ?? ""));
  const at = typeof raw.at === "number" ? raw.at : now;
  const text = (value: unknown, max = 300) => String(value ?? "").slice(0, max);
  switch (raw.kind) {
    case "click":
      return { kind: "click", at, url, selector: text(raw.selector, 500), label: text(raw.label), x: Number(raw.x) || 0, y: Number(raw.y) || 0 };
    case "input": {
      const selector = text(raw.selector, 500);
      const label = text(raw.label);
      const value = text(raw.value, 2000);
      const masked = shouldMask(label, selector, value, raw.masked === true);
      return { kind: "input", at, url, selector, label, value: masked ? MASK : value, masked };
    }
    case "select":
      return { kind: "select", at, url, selector: text(raw.selector, 500), label: text(raw.label), value: text(raw.value) };
    case "key":
      return { kind: "key", at, url, key: text(raw.key, 40) };
    default:
      return null;
  }
}

export const BROWSER_EVENT_KINDS = ["navigate", "click", "input", "select", "key"] as const;

export function sanitizeBrowserEvent(event: RecordedEvent): RecordedEvent | null {
  const text = (value: string, max: number) => value.slice(0, max);
  switch (event.kind) {
    case "navigate":
      return { kind: "navigate", at: event.at, url: text(sanitizeRequestUrl(event.url), 2000), ...(event.title ? { title: text(event.title, 300) } : {}) };
    case "click":
      return { kind: "click", at: event.at, url: text(sanitizeRequestUrl(event.url), 2000), selector: text(event.selector, 500), label: text(event.label, 300), x: event.x, y: event.y };
    case "input": {
      const selector = text(event.selector, 500);
      const label = text(event.label, 300);
      const value = text(event.value, 2000);
      const masked = shouldMask(label, selector, value, event.masked);
      return { kind: "input", at: event.at, url: text(sanitizeRequestUrl(event.url), 2000), selector, label, value: masked ? MASK : value, masked };
    }
    case "select":
      return { kind: "select", at: event.at, url: text(sanitizeRequestUrl(event.url), 2000), selector: text(event.selector, 500), label: text(event.label, 300), value: text(event.value, 300) };
    case "key":
      return { kind: "key", at: event.at, url: text(sanitizeRequestUrl(event.url), 2000), key: text(event.key, 40) };
    default:
      return null;
  }
}
