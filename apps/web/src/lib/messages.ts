import { en, type Messages } from "./i18n/en";
import { ptBR } from "./i18n/pt-BR";

const dictionaries: Record<string, Messages> = { en, "pt-BR": ptBR };

export const LOCALES = Object.keys(dictionaries);

export function serverLocale() {
  const wanted = process.env.UNDERSTUDY_LOCALE?.trim();
  return wanted && dictionaries[wanted] ? wanted : "en";
}

export function currentLocale() {
  if (typeof document !== "undefined") return document.documentElement.lang || "en";
  return serverLocale();
}

function dictionary(): Messages {
  return dictionaries[currentLocale()] ?? en;
}

export const messages = new Proxy({} as Messages, {
  get(_, key: string) {
    return dictionary()[key as keyof Messages];
  },
});

export type { Messages };
