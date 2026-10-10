export function credentialSite(raw: unknown) {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!text) return null;
  const host = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^\*\./, "");
  if (host.length > 253 || !host.includes(".")) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  if (host.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return null;
  return host;
}
