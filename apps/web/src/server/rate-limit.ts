type Bucket = { tokens: number; at: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  allow(key: string, perSecond: number, burst: number) {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: burst, at: now };
    bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * perSecond);
    bucket.at = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  forget(prefix: string) {
    for (const key of this.buckets.keys()) if (key.startsWith(prefix)) this.buckets.delete(key);
  }
}

const LIMITS: Record<string, [number, number]> = {
  frame: [30, 60],
  chat: [5, 50],
  activity: [5, 50],
  recorded: [20, 200],
  approval_request: [1, 5],
  run_record: [1, 5],
  file_content: [2, 10],
  upload_state: [40, 400],
  upload_done: [10, 100],
  file_chunk: [40, 400],
  file_shared: [5, 50],
  artifact_rendered: [2, 20],
  files: [1, 10],
  memory: [1, 10],
  credentials: [1, 10],
  terminal_output: [200, 2000],
  chat_delta: [8, 40],
  terminal_exit: [2, 20],
  jobs: [2, 20],
  rule_blocked: [1, 10],
  watch_result: [1, 20],
};

export function computerLimit(type: string): [number, number] {
  return LIMITS[type] ?? [10, 100];
}
