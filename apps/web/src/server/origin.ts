export function originAllowed(origin: string | undefined, publicUrl: string) {
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}
