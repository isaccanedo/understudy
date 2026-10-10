export function log(scope: string, message: string): void {
  process.stdout.write(`${new Date().toISOString()} [${scope}] ${message}\n`);
}
