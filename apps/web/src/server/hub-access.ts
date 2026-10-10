import type { Hub } from "./hub";

export function getHub(): Hub | null {
  return (globalThis as unknown as { __understudyHub?: Hub }).__understudyHub ?? null;
}
