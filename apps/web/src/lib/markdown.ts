export type Inline =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "strike"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

export type ListItem = { depth: number; children: Inline[] };

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "code"; lang: string; value: string; open: boolean }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; children: Block[] }
  | { kind: "rule" };

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:"];

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || /[\s<>"']/.test(href)) return null;
  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const AUTOLINK = /^https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;

function pushText(out: Inline[], value: string) {
  const last = out[out.length - 1];
  if (last?.kind === "text") last.value += value;
  else out.push({ kind: "text", value });
}

function wrap(source: string, at: number, marker: string): { inner: string; end: number } | null {
  const after = source[at + marker.length];
  if (!after || /\s/.test(after)) return null;
  let close = source.indexOf(marker, at + marker.length + 1);
  while (close !== -1 && /\s/.test(source[close - 1])) close = source.indexOf(marker, close + 1);
  if (close === -1) return null;
  if (marker === "_" && /\w/.test(source[close + 1] ?? "")) return null;
  return { inner: source.slice(at + marker.length, close), end: close + marker.length };
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const ch = source[i];

    if (ch === "\\" && i + 1 < source.length && /[\\`*_[\]()~#>-]/.test(source[i + 1])) {
      pushText(out, source[i + 1]);
      i += 2;
      continue;
    }
    if (ch === "\n") {
      out.push({ kind: "break" });
      i += 1;
      continue;
    }
    if (ch === "`") {
      const close = source.indexOf("`", i + 1);
      if (close > i + 1) {
        out.push({ kind: "code", value: source.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const marker = rest.slice(0, 2);
      const hit = wrap(source, i, marker);
      if (hit) {
        out.push({ kind: "strong", children: parseInline(hit.inner) });
        i = hit.end;
        continue;
      }
    }
    if (rest.startsWith("~~")) {
      const hit = wrap(source, i, "~~");
      if (hit) {
        out.push({ kind: "strike", children: parseInline(hit.inner) });
        i = hit.end;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && !(ch === "_" && /\w/.test(source[i - 1] ?? ""))) {
      const hit = wrap(source, i, ch);
      if (hit) {
        out.push({ kind: "em", children: parseInline(hit.inner) });
        i = hit.end;
        continue;
      }
    }
    if (ch === "[") {
      const match = LINK.exec(rest);
      if (match) {
        const href = safeHref(match[2]);
        if (href) out.push({ kind: "link", href, children: parseInline(match[1]) });
        else pushText(out, match[1]);
        i += match[0].length;
        continue;
      }
    }
    if (ch === "h" && !/\w/.test(source[i - 1] ?? "")) {
      const match = AUTOLINK.exec(rest);
      const href = match && safeHref(match[0]);
      if (match && href) {
        out.push({ kind: "link", href, children: [{ kind: "text", value: match[0] }] });
        i += match[0].length;
        continue;
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

const FENCE = /^ {0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;

function depthOf(indent: string) {
  return Math.min(3, Math.floor(indent.replace(/\t/g, "  ").length / 2));
}

function startsBlock(line: string) {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line) || RULE.test(line);
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      let open = true;
      while (i < lines.length) {
        if (lines[i].trim() === fence[1]) {
          open = false;
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: "code", lang: fence[2], value: body.join("\n"), open });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      blocks.push({ kind: "quote", children: parseMarkdown(body.join("\n")) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const pattern = isOrdered ? ORDERED : BULLET;
      const items: ListItem[] = [];
      const start = ordered ? Number(ordered[2]) : 1;
      while (i < lines.length) {
        const current = lines[i];
        const match = pattern.exec(current) ?? (isOrdered ? BULLET.exec(current) : ORDERED.exec(current));
        if (match && (pattern.test(current) || depthOf(match[1]) > 0)) {
          items.push({ depth: depthOf(match[1]), children: parseInline(match[match.length - 1]) });
          i += 1;
          continue;
        }
        if (current.trim() && /^\s{2,}\S/.test(current) && items.length > 0) {
          const last = items[items.length - 1];
          last.children.push({ kind: "break" }, ...parseInline(current.trim()));
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered: isOrdered, start, items });
      continue;
    }

    const body: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(body.join("\n")) });
  }

  return blocks;
}
