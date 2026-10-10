export type SesVerdicts = {
  spamVerdict?: { status?: string };
  virusVerdict?: { status?: string };
  spfVerdict?: { status?: string };
  dkimVerdict?: { status?: string };
  dmarcVerdict?: { status?: string };
};

const LOCAL_PART = /^[a-z0-9][a-z0-9-]{0,60}\.[a-z2-7]{10}$/;

export function inboundLocalParts(recipients: string[], domain: string) {
  const suffix = `@${domain.trim().toLowerCase()}`;
  const parts = new Set<string>();
  for (const recipient of recipients) {
    const address = recipient.trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
    if (!address.endsWith(suffix)) continue;
    const local = address.slice(0, -suffix.length).replace(/\+.*$/, "");
    if (LOCAL_PART.test(local)) parts.add(local);
  }
  return [...parts];
}

export function parseSenderList(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function senderAllowed(from: string | null, allowed: string[], ownerEmail: string) {
  if (!from || !from.includes("@")) return false;
  const address = from.trim().toLowerCase();
  const domain = address.split("@").pop() as string;
  const rules = allowed.length > 0 ? allowed : [ownerEmail.trim().toLowerCase().split("@").pop() as string];
  return rules.some((rule) => (rule.includes("@") ? rule === address : rule === domain));
}

export function verdictProblem(receipt: SesVerdicts | undefined) {
  if (!receipt) return "no_verdicts";
  if (receipt.virusVerdict?.status === "FAIL") return "virus";
  if (receipt.spamVerdict?.status === "FAIL") return "spam";
  return receipt.dmarcVerdict?.status === "PASS" ? null : "sender_not_authenticated";
}
