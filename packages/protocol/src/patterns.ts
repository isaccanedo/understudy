export type Locale = "en" | "pt-BR";

export const IRREVERSIBLE_WORDS: Record<Locale, string[]> = {
  en: ["submit", "send", "pay", "emit", "issue", "delete", "remove", "purchase", "buy", "publish", "transfer", "approve", "confirm", "cancel"],
  "pt-BR": [
    "envi(?:ar|e|a)",
    "submeter",
    "pag(?:ar|ue|a)",
    "emit(?:ir|a|e)",
    "exclu(?:ir|a|i)",
    "apag(?:ar|ue|a)",
    "delet(?:ar|e|a)",
    "remov(?:er|a|e)",
    "compr(?:ar|e|a)",
    "public(?:ar|a|que)",
    "transfer(?:ir|a|e)",
    "assin(?:ar|e|a)",
    "aprov(?:ar|e|a)",
    "confirm(?:ar|e|a)",
    "cancel(?:ar|e|a)",
    "finaliz(?:ar|e|a)",
    "disparar",
    "protocolar",
  ],
};

export const SENSITIVE_LABEL_WORDS: Record<Locale, string[]> = {
  en: [
    "passw",
    "secret",
    "token",
    "api.?key",
    "\\bpin\\b",
    "otp",
    "one.?time",
    "verification code",
    "card",
    "cvv",
    "cvc",
    "security code",
    "expir",
    "\\bssn\\b",
    "social security",
    "passport",
    "iban",
    "routing",
    "account number",
  ],
  "pt-BR": [
    "senha",
    "segredo",
    "chave",
    "c[oó]digo de (?:verifica|seguran)",
    "cart[aã]o",
    "validade",
    "\\bcpf\\b",
    "\\bcnpj\\b",
    "\\brg\\b",
    "passaporte",
  ],
};

function anyOf(words: Record<Locale, string[]>, wrap: (body: string) => string): RegExp {
  return new RegExp(wrap(Object.values(words).flat().join("|")), "i");
}

export const IRREVERSIBLE = anyOf(IRREVERSIBLE_WORDS, (body) => `\\b(?:${body})\\b`);

export const SENSITIVE_LABEL = anyOf(SENSITIVE_LABEL_WORDS, (body) => `(?:${body})`);

export function looksIrreversible(text: string): boolean {
  return IRREVERSIBLE.test(text);
}
