export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "key";

export type Token = { kind: TokenKind; text: string };

const KEYWORDS: Record<string, string[]> = {
  javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "class", "extends", "import", "from", "export", "default", "async", "await", "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "null", "undefined", "true", "false", "this", "yield"],
  typescript: ["type", "interface", "enum", "implements", "readonly", "as", "keyof", "satisfies", "declare", "namespace", "private", "public", "protected"],
  python: ["def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import", "from", "as", "class", "try", "except", "finally", "raise", "with", "lambda", "yield", "None", "True", "False", "pass", "break", "continue", "global", "async", "await", "is"],
  ruby: ["def", "end", "if", "elsif", "else", "unless", "do", "class", "module", "return", "nil", "true", "false", "require", "yield", "begin", "rescue", "self"],
  go: ["func", "package", "import", "return", "if", "else", "for", "range", "var", "const", "type", "struct", "interface", "map", "chan", "go", "defer", "nil", "true", "false", "switch", "case"],
  rust: ["fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "use", "mod", "match", "if", "else", "for", "while", "loop", "return", "true", "false", "self", "Self", "async", "await"],
  shell: ["if", "then", "else", "fi", "for", "in", "do", "done", "while", "case", "esac", "function", "return", "export", "local", "echo"],
  sql: ["select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create", "table", "join", "left", "right", "inner", "on", "group", "by", "order", "limit", "as", "null", "is", "distinct", "having", "union"],
  elixir: ["def", "defp", "defmodule", "do", "end", "if", "else", "case", "cond", "fn", "with", "alias", "import", "use", "nil", "true", "false"],
};

const COMMENTS: Record<string, string[]> = {
  python: ["#"],
  ruby: ["#"],
  shell: ["#"],
  yaml: ["#"],
  toml: ["#"],
  elixir: ["#"],
  sql: ["--"],
};

function keywordsFor(lang: string): Set<string> {
  if (lang === "typescript") return new Set([...KEYWORDS.javascript, ...KEYWORDS.typescript]);
  return new Set(KEYWORDS[lang] ?? (["java", "kotlin", "c", "cpp", "csharp", "php"].includes(lang) ? KEYWORDS.javascript : []));
}

function lineComments(lang: string) {
  return COMMENTS[lang] ?? (["json", "csv", "markdown", "text", "html", "xml", "css"].includes(lang) ? [] : ["//"]);
}

export function highlight(code: string, lang: string): Token[] {
  if (lang === "text" || lang === "csv" || lang === "markdown") return [{ kind: "plain", text: code }];
  const keywords = keywordsFor(lang);
  const comments = lineComments(lang);
  const caseless = lang === "sql";
  const blockComments = !["python", "ruby", "shell", "yaml", "toml", "elixir", "json"].includes(lang);
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    const comment = comments.find((marker) => rest.startsWith(marker));
    if (comment) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (blockComments && rest.startsWith("/*")) {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (lang === "html" || lang === "xml") {
      if (rest.startsWith("<!--")) {
        const end = code.indexOf("-->", i + 4);
        const stop = end === -1 ? code.length : end + 3;
        push("comment", code.slice(i, stop));
        i = stop;
        continue;
      }
    }
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      const stop = Math.min(code.length, j + 1);
      const text = code.slice(i, stop);
      const isKey = (lang === "json" || lang === "yaml") && /^\s*:/.test(code.slice(stop, stop + 4));
      push(isKey ? "key" : "string", text);
      i = stop;
      continue;
    }
    const number = /^-?\d+(\.\d+)?([eE][+-]?\d+)?\b/.exec(rest);
    if (number && !/[A-Za-z0-9_]/.test(code[i - 1] ?? "")) {
      push("number", number[0]);
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
    if (word) {
      const value = word[0];
      const isKeyword = keywords.has(caseless ? value.toLowerCase() : value) || ((lang === "json" || lang === "yaml" || lang === "toml") && ["true", "false", "null"].includes(value));
      const isYamlKey = (lang === "yaml" || lang === "toml") && /^\s*[:=]/.test(code.slice(i + value.length, i + value.length + 3)) && /(^|\n)\s*$/.test(code.slice(0, i));
      push(isKeyword ? "keyword" : isYamlKey ? "key" : "plain", value);
      i += value.length;
      continue;
    }
    push("plain", ch);
    i++;
  }
  return tokens;
}
