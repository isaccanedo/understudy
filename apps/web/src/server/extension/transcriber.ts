import type { Transcript, TranscriptSegment } from "./narration";

export type Transcriber = {
  name: string;
  transcribe: (audio: Buffer, mediaType: string) => Promise<Transcript>;
};

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

const TIMEOUT_MS = 3 * 60 * 1000;

function value(env: Env, key: string) {
  return env[key]?.trim() || undefined;
}

function segmentsFrom(raw: unknown): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((segment) => {
      const item = segment as Record<string, unknown>;
      const start = Number(item.startSecond ?? item.start);
      const end = Number(item.endSecond ?? item.end ?? start);
      return { start, end, text: String(item.text ?? "") };
    })
    .filter((segment) => Number.isFinite(segment.start) && segment.text.trim());
}

function transcriptFrom(body: Record<string, unknown>): Transcript {
  const duration = Number(body.durationInSeconds ?? body.duration);
  return {
    text: String(body.text ?? ""),
    segments: segmentsFrom(body.segments),
    ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
  };
}

async function failure(response: Response) {
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  return new Error(`transcription failed with ${response.status}${detail ? `: ${detail}` : ""}`);
}

export function gatewayTranscriber(options: { apiKey: string; model: string; baseUrl: string; language?: string; fetch?: Fetch }): Transcriber {
  const call = options.fetch ?? fetch;
  return {
    name: `gateway:${options.model}`,
    async transcribe(audio, mediaType) {
      const response = await call(`${options.baseUrl.replace(/\/$/, "")}/v4/ai/transcription-model`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "ai-gateway-protocol-version": "0.0.1",
          "ai-transcription-model-specification-version": "4",
          "ai-model-id": options.model,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio: audio.toString("base64"),
          mediaType,
          ...(options.language ? { providerOptions: { openai: { language: options.language } } } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw await failure(response);
      return transcriptFrom((await response.json()) as Record<string, unknown>);
    },
  };
}

export function openAiTranscriber(options: { apiKey: string; model: string; baseUrl: string; language?: string; fetch?: Fetch }): Transcriber {
  const call = options.fetch ?? fetch;
  return {
    name: `openai:${options.model}`,
    async transcribe(audio, mediaType) {
      const form = new FormData();
      const extension = mediaType.includes("ogg") ? "ogg" : mediaType.includes("mp4") ? "mp4" : mediaType.includes("mpeg") ? "mp3" : mediaType.includes("wav") ? "wav" : "webm";
      form.append("file", new Blob([new Uint8Array(audio)], { type: mediaType }), `narration.${extension}`);
      form.append("model", options.model);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
      if (options.language) form.append("language", options.language);
      const response = await call(`${options.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw await failure(response);
      return transcriptFrom((await response.json()) as Record<string, unknown>);
    },
  };
}

export function fakeTranscriber(text = "This is a fake transcript of what the owner said."): Transcriber {
  return {
    name: "fake",
    async transcribe(audio) {
      if (!audio.length) return { text: "", segments: [] };
      return { text, segments: [{ start: 0, end: 1, text }] };
    },
  };
}

export function transcriberFromEnv(env: Env = process.env): Transcriber | null {
  const kind = value(env, "UNDERSTUDY_TRANSCRIBER")?.toLowerCase();
  const language = value(env, "UNDERSTUDY_TRANSCRIBE_LANGUAGE");
  const explicitKey = value(env, "UNDERSTUDY_TRANSCRIBE_API_KEY");
  const gatewayKey = explicitKey ?? value(env, "AI_GATEWAY_API_KEY");
  if (kind === "off" || kind === "none") return null;
  if (kind === "fake") return fakeTranscriber(value(env, "UNDERSTUDY_FAKE_TRANSCRIPT"));
  if (kind === "openai" || (!kind && explicitKey && value(env, "UNDERSTUDY_TRANSCRIBE_URL"))) {
    if (!explicitKey) return null;
    return openAiTranscriber({
      apiKey: explicitKey,
      model: value(env, "UNDERSTUDY_TRANSCRIBE_MODEL") ?? "whisper-1",
      baseUrl: value(env, "UNDERSTUDY_TRANSCRIBE_URL") ?? "https://api.openai.com/v1",
      language,
    });
  }
  if (kind === "gateway" || (!kind && gatewayKey)) {
    if (!gatewayKey) return null;
    return gatewayTranscriber({
      apiKey: gatewayKey,
      model: value(env, "UNDERSTUDY_TRANSCRIBE_MODEL") ?? "openai/whisper-1",
      baseUrl: value(env, "UNDERSTUDY_TRANSCRIBE_URL") ?? "https://ai-gateway.vercel.sh",
      language,
    });
  }
  return null;
}
