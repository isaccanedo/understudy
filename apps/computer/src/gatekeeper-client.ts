import { gatekeeperUrl } from "./endpoints.ts";

export type McpSession = { call: (name: string, args: Record<string, unknown>) => Promise<string> };

function parseRpc(body: string, contentType: string, id: number): any {
  const messages = contentType.includes("text/event-stream")
    ? body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => {
          try {
            return JSON.parse(line.slice(5).trim());
          } catch {
            return null;
          }
        })
    : [JSON.parse(body)];
  return messages.flat().find((message) => message && message.id === id);
}

export async function openGatekeeper(serverUrl: string, token: string, signal?: AbortSignal): Promise<McpSession> {
  const url = gatekeeperUrl(serverUrl);
  let sessionId: string | null = null;
  let next = 0;
  const post = async (message: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify(message),
    });
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    return { body: await response.text(), contentType: response.headers.get("content-type") ?? "", status: response.status };
  };
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = ++next;
    const reply = await post({ jsonrpc: "2.0", id, method, params });
    if (reply.status >= 400) throw new Error(`gatekeeper answered HTTP ${reply.status}`);
    const message = parseRpc(reply.body, reply.contentType, id);
    if (!message) throw new Error("gatekeeper sent no answer");
    if (message.error) throw new Error(message.error.message ?? "gatekeeper error");
    return message.result;
  };
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "understudy-fake-brain", version: "1" } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    async call(name, args) {
      const result = await request("tools/call", { name, arguments: args });
      return (result?.content ?? []).map((part: { text?: string }) => part.text ?? "").join("\n");
    },
  };
}

