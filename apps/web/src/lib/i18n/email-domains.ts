export function emailDomains(domains: string[], locale: string) {
  return new Intl.ListFormat(locale, { type: "disjunction" }).format(domains.map((domain) => `@${domain}`));
}
