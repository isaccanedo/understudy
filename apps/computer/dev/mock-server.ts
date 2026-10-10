import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { WebSocketServer, type WebSocket } from "ws";
import { parseComputerToServer, type ApprovalRequest, type ComputerToServer, type Recipe, type ServerToComputer, type ServerToHost } from "@understudy/protocol";

const PORT = Number(process.env.MOCK_PORT || 8787);
const TOKEN = process.env.MOCK_TOKEN || "dev-token";
const HOST_TOKEN = process.env.MOCK_HOST_TOKEN || "dev-host-token";
const AUTO_APPROVE = process.env.MOCK_AUTO_APPROVE === "1";
const APPROVAL_CAP_MS = Number(process.env.MOCK_APPROVAL_CAP_SECONDS || 3000) * 1000;

const computers = new Map<string, WebSocket>();
const viewers = new Map<string, Set<WebSocket>>();
const hosts = new Set<WebSocket>();
type Answer = { approved: boolean; note?: string };
const approvals = new Map<string, { request: ApprovalRequest; answer?: Answer; waiters: ((answer: Answer) => void)[] }>();
const recipes: Recipe[] = [];
let lastAgent = process.env.MOCK_AGENT || "dev";

const say = (text: string) => process.stdout.write(`[mock] ${text}\n`);

const bearer = (request: IncomingMessage) => (request.headers.authorization || "").replace(/^Bearer\s+/i, "");

function toComputer(agentId: string, message: ServerToComputer) {
  const socket = computers.get(agentId);
  if (!socket) {
    say(`no computer connected for ${agentId}`);
    return;
  }
  socket.send(JSON.stringify(message));
}

function toViewers(agentId: string, message: unknown) {
  const text = JSON.stringify(message);
  for (const socket of viewers.get(agentId) ?? []) socket.send(text);
}

function announceViewers(agentId: string) {
  toComputer(agentId, { type: "viewers", count: viewers.get(agentId)?.size ?? 0 });
}

function onComputerMessage(agentId: string, message: ComputerToServer) {
  toViewers(agentId, message);
  switch (message.type) {
    case "frame":
      return;
    case "recorded":
      if (message.event.kind !== "screenshot") say(`recorded ${JSON.stringify(message.event).slice(0, 200)}`);
      else say("recorded screenshot");
      return;
    case "files":
      say(`outbox: ${message.files.map((file) => `${file.path} (${file.size} B)`).join(", ") || "(empty)"}`);
      return;
    case "file_content":
      say(`file ${message.path}: ${message.error ?? Buffer.from(message.base64 ?? "", "base64").toString("utf8").slice(0, 200)}`);
      return;
    case "credentials":
      say(`credentials: ${message.credentials.map((entry) => `${entry.name} (${entry.username}${entry.site ? ` @ ${entry.site}` : ""})`).join(", ") || "(none)"}`);
      return;
    case "run_record":
      say(`run record ${message.runId}: ${message.steps.length} steps, ${message.steps.filter((step) => step.screenshotJpegBase64).length} screenshots${message.unusual?.length ? `, unusual: ${message.unusual.join("; ")}` : ""}`);
      return;
    case "memory":
      say(`memory: ${message.files.map((file) => `${file.path} (${file.text.length} chars)`).join(", ")}`);
      return;
    case "recipe":
      recipes.push(message.recipe);
      say(`recipe:\n${JSON.stringify(message.recipe, null, 2)}`);
      return;
    default:
      say(`${agentId} -> ${JSON.stringify(message).slice(0, 400)}`);
  }
}

function openApproval(agentId: string, request: ApprovalRequest) {
  approvals.set(request.id, { request, waiters: [] });
  toViewers(agentId, { type: "approval_request", request });
  say(`APPROVAL ${request.id}: ${request.summary} ${JSON.stringify(request.fields)}  (type "approve ${request.id}" or "deny ${request.id} <note>")`);
  if (AUTO_APPROVE) answerApproval(request.id, true);
}

function awaitApproval(id: string): Promise<Answer | "pending" | "unknown"> {
  const entry = approvals.get(id);
  if (!entry) return Promise.resolve("unknown");
  if (entry.answer) return Promise.resolve(entry.answer);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      entry.waiters = entry.waiters.filter((waiter) => waiter !== done);
      resolve("pending");
    }, APPROVAL_CAP_MS);
    const done = (answer: Answer) => {
      clearTimeout(timer);
      resolve(answer);
    };
    entry.waiters.push(done);
  });
}

function answerApproval(id: string, approved: boolean, note?: string) {
  const entry = approvals.get(id) ?? [...approvals.values()].find((candidate) => candidate.request.id.startsWith(id));
  if (!entry || entry.answer) {
    say(`no open approval ${id}`);
    return;
  }
  entry.answer = { approved, note };
  for (const waiter of entry.waiters.splice(0)) waiter(entry.answer);
  say(`approval ${entry.request.id} ${approved ? "approved" : "denied"}`);
}

function approvalText(id: string, result: Answer | "pending" | "unknown"): string {
  if (result === "pending") return JSON.stringify({ status: "pending", requestId: id });
  if (result === "unknown") return "denied: unknown request";
  return result.approved ? `approved${result.note ? `: ${result.note}` : ""}` : `denied${result.note ? `: ${result.note}` : ""}`;
}

const TOOLS = [
  {
    name: "request_approval",
    description: "Ask the owner to approve a step before doing it. Blocks until the owner answers. Returns approved or denied with an optional note.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        stepId: { type: "string" },
        summary: { type: "string", description: "One line: exactly what you are about to do." },
        fields: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] } },
      },
      required: ["summary"],
    },
  },
  {
    name: "wait_for_approval",
    description: "Keep waiting for an approval that came back pending. Returns the decision or pending again.",
    inputSchema: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"] },
  },
];

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleMcp(request: IncomingMessage, response: ServerResponse) {
  const agentId = [...computers.keys()][0] ?? lastAgent;
  if (bearer(request) !== TOKEN) {
    response.writeHead(401).end();
    return;
  }
  if (request.method === "GET") {
    response.writeHead(405).end();
    return;
  }
  if (request.method === "DELETE") {
    response.writeHead(200).end();
    return;
  }
  const payload = JSON.parse(await readBody(request));
  const messages = Array.isArray(payload) ? payload : [payload];
  const results: unknown[] = [];
  const sessionId = (request.headers["mcp-session-id"] as string) || randomUUID();
  for (const message of messages) {
    if (message.id === undefined) continue;
    const reply = (result: unknown) => results.push({ jsonrpc: "2.0", id: message.id, result });
    if (message.method === "initialize") {
      reply({ protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-gatekeeper", version: "0.0.1" } });
    } else if (message.method === "tools/list") {
      reply({ tools: TOOLS });
    } else if (message.method === "ping") {
      reply({});
    } else if (message.method === "tools/call" && message.params?.name === "request_approval") {
      const args = message.params.arguments ?? {};
      const approvalRequest: ApprovalRequest = {
        id: randomUUID().slice(0, 8),
        runId: String(args.runId ?? ""),
        stepId: args.stepId ? String(args.stepId) : undefined,
        summary: String(args.summary ?? ""),
        fields: Array.isArray(args.fields) ? args.fields.map((field: { label: unknown; value: unknown }) => ({ label: String(field.label), value: String(field.value) })) : [],
      };
      openApproval(agentId, approvalRequest);
      reply({ content: [{ type: "text", text: approvalText(approvalRequest.id, await awaitApproval(approvalRequest.id)) }] });
    } else if (message.method === "tools/call" && message.params?.name === "wait_for_approval") {
      const id = String(message.params.arguments?.requestId ?? "");
      say(`brain is still waiting on ${id}`);
      reply({ content: [{ type: "text", text: approvalText(id, await awaitApproval(id)) }] });
    } else {
      results.push({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } });
    }
  }
  if (!results.length) {
    response.writeHead(202, { "Mcp-Session-Id": sessionId }).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": sessionId });
  response.end(JSON.stringify(Array.isArray(payload) ? results : results[0]));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/api/mcp") {
    void handleMcp(request, response).catch((error) => {
      say(`mcp error ${error.message}`);
      if (!response.headersSent) response.writeHead(500).end();
    });
    return;
  }
  if (url.pathname === "/form") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(FORM_HTML);
    return;
  }
  if (url.pathname === "/api/echo") {
    void readBody(request).then((body) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, received: body.length }));
    });
    return;
  }
  if (url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(VIEWER_HTML);
    return;
  }
  response.writeHead(404).end();
});

server.requestTimeout = 0;
server.headersTimeout = 0;

const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const agentId = url.searchParams.get("agent") || "";
  if (url.pathname === "/api/ws/computer") {
    if (bearer(request) !== TOKEN || !agentId) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      computers.get(agentId)?.close();
      computers.set(agentId, ws);
      lastAgent = agentId;
      say(`computer ${agentId} connected`);
      ws.on("message", (data) => {
        const parsed = parseComputerToServer(data.toString());
        if (!parsed.ok) {
          say(`INVALID message from ${agentId}: ${parsed.error}`);
          return;
        }
        const message = parsed.message;
        if (message.type === "hello") announceViewers(agentId);
        onComputerMessage(agentId, message);
      });
      ws.on("close", () => {
        if (computers.get(agentId) === ws) computers.delete(agentId);
        say(`computer ${agentId} disconnected`);
      });
    });
    return;
  }
  if (url.pathname === "/api/ws/host") {
    if (bearer(request) !== HOST_TOKEN) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      hosts.add(ws);
      say("host connected");
      ws.on("message", (data) => say(`host -> ${data.toString()}`));
      ws.on("close", () => hosts.delete(ws));
    });
    return;
  }
  if (url.pathname === "/api/ws/viewer") {
    const viewed = agentId || lastAgent;
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const set = viewers.get(viewed) ?? new Set();
      set.add(ws);
      viewers.set(viewed, set);
      announceViewers(viewed);
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "approval_answer") {
          answerApproval(message.requestId, message.approved, message.note);
          return;
        }
        if (message.type === "run_last") {
          runLast(viewed, message.context);
          return;
        }
        toComputer(viewed, message as ServerToComputer);
      });
      ws.on("close", () => {
        set.delete(ws);
        announceViewers(viewed);
      });
    });
    return;
  }
  socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
});

function runLast(agentId: string, context?: string) {
  const recipe = recipes.at(-1);
  if (!recipe) {
    say("no recipe yet");
    return;
  }
  const runId = `run-${Date.now()}`;
  say(`running "${recipe.title}" as ${runId}`);
  toComputer(agentId, { type: "run_recipe", runId, recipe, approvalsRequired: true, context });
}

function toHosts(message: ServerToHost) {
  for (const socket of hosts) socket.send(JSON.stringify(message));
  if (!hosts.size) say("no host connected");
}

const HELP = `commands:
  chat <text>                 send a chat message
  nav <url>                   navigate the browser
  watch <n>                   pretend n viewers are watching
  rec start | rec stop        record a lesson
  say <text>                  narration while recording
  run [context]               run the last recipe (approvals required)
  recipe <file.json>          load a recipe from a file
  approve <id> | deny <id> [note]
  login claude|codex          start a login
  code <code>                 paste the claude login code
  memwrite <path> <text>      owner edits a memory file
  memdel <path>               owner deletes a memory file
  put <path> <text>           owner uploads a file into ~/files/inbox
  get <path>                  owner downloads a file from ~/files/outbox
  teach <description>         teach a task by describing it
  cred <name> <user> <secret> [site]  save a login in the vault
  uncred <name>               delete a saved login
  brain claude|codex          switch brain
  stop                        stop the current work
  ensure <agentId> <image> <serverUrl> <token> | hstop <agentId> | destroy <agentId>   host commands`;

let recordingId = "";
createInterface({ input: process.stdin }).on("line", async (line) => {
  const [command, ...rest] = line.trim().split(" ");
  const arg = rest.join(" ");
  const agent = lastAgent;
  switch (command) {
    case "chat":
      return toComputer(agent, { type: "chat", text: arg, from: "Dev" });
    case "nav":
      return toComputer(agent, { type: "input", event: { kind: "navigate", url: arg } });
    case "watch":
      return toComputer(agent, { type: "viewers", count: Number(arg) || 0 });
    case "rec":
      if (arg === "start") {
        recordingId = `rec-${Date.now()}`;
        return toComputer(agent, { type: "record_start", recordingId });
      }
      return toComputer(agent, { type: "record_stop", recordingId });
    case "say":
      return toComputer(agent, { type: "record_narration", recordingId, text: arg });
    case "run":
      return runLast(agent, arg || undefined);
    case "recipe": {
      const { readFileSync } = await import("node:fs");
      recipes.push(JSON.parse(readFileSync(arg, "utf8")));
      return say("recipe loaded");
    }
    case "approve":
      return answerApproval(rest[0], true);
    case "deny":
      return answerApproval(rest[0], false, rest.slice(1).join(" ") || undefined);
    case "login":
      return toComputer(agent, { type: "login_start", brain: arg === "codex" ? "codex" : "claude" });
    case "code":
      return toComputer(agent, { type: "login_code", brain: "claude", code: arg });
    case "memwrite":
      return toComputer(agent, { type: "memory_write", path: rest[0], text: rest.slice(1).join(" ") });
    case "put":
      return toComputer(agent, { type: "file_put", path: rest[0], base64: Buffer.from(rest.slice(1).join(" ")).toString("base64") });
    case "get":
      return toComputer(agent, { type: "file_get", requestId: `get-${Date.now()}`, path: rest[0] });
    case "teach":
      return toComputer(agent, { type: "teach_text", recordingId: `text-${Date.now()}`, text: arg });
    case "cred":
      return toComputer(agent, { type: "credential_set", name: rest[0], username: rest[1], secret: rest[2], ...(rest[3] ? { site: rest[3] } : {}) });
    case "uncred":
      return toComputer(agent, { type: "credential_delete", name: rest[0] });
    case "memdel":
      return toComputer(agent, { type: "memory_delete", path: rest[0] });
    case "brain":
      return toComputer(agent, { type: "set_brain", brain: arg === "codex" ? "codex" : "claude" });
    case "stop":
      return toComputer(agent, { type: "stop" });
    case "ensure":
      return toHosts({ type: "computer_ensure", spec: { agentId: rest[0], image: rest[1], serverUrl: rest[2], token: rest[3] } });
    case "hstop":
      return toHosts({ type: "computer_stop", agentId: rest[0] });
    case "destroy":
      return toHosts({ type: "computer_destroy", agentId: rest[0] });
    case "":
      return;
    default:
      say(HELP);
  }
});

setInterval(() => {
  for (const agentId of computers.keys()) toComputer(agentId, { type: "ping", at: Date.now() });
}, 30000);

server.listen(PORT, () => {
  say(`listening on http://localhost:${PORT} (computer token "${TOKEN}", host token "${HOST_TOKEN}")`);
  say(HELP);
});

const FORM_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Student registration</title>
<style>body{margin:0;font:16px system-ui} .f{position:absolute;left:100px;width:300px;height:32px} label{position:absolute;left:100px;font-size:12px}</style></head><body>
<form id="registration">
<label for="name" style="top:80px">Student name</label><input class="f" id="name" name="name" style="top:100px">
<label for="password" style="top:160px">Portal password</label><input class="f" id="password" type="password" name="password" style="top:180px">
<label for="class" style="top:240px">Class</label><select class="f" id="class" name="class" style="top:260px"><option>5A</option><option>6B</option></select>
<label for="doc" style="top:300px">Document</label><input class="f" id="doc" type="file" name="doc" style="top:316px;height:20px">
<button class="f" type="submit" style="top:340px">Send registration</button>
</form><p id="done" style="position:absolute;top:400px;left:100px"></p>
<script>document.getElementById("registration").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/echo?student="+encodeURIComponent(document.getElementById("name").value),{method:"POST",body:new FormData(e.target)});document.getElementById("done").textContent=r.ok?"Registration sent":"Failed"}</script>
</body></html>`;

const VIEWER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Understudy mock viewer</title>
<style>
body{font:14px system-ui;margin:12px;display:grid;grid-template-columns:1280px 1fr;gap:12px;background:#f6f6f4}
#screen{width:1280px;height:800px;background:#222;cursor:crosshair;outline:none}
#log{height:560px;overflow:auto;background:#fff;border:1px solid #ddd;padding:8px;font:12px ui-monospace,monospace;white-space:pre-wrap}
input{width:60%} button{margin:2px} .row{margin:4px 0}
#approvals div{background:#fff3c4;padding:6px;margin:4px 0}
</style></head><body>
<div><div class="row"><input id="url" placeholder="url"><button id="go">go</button> <span id="state">-</span></div>
<img id="screen" tabindex="0" draggable="false"></div>
<div>
<div class="row"><input id="chat" placeholder="chat"><button id="send">send</button></div>
<div class="row"><button id="recStart">rec start</button><button id="recStop">rec stop</button><input id="narr" placeholder="narration"><button id="narrate">say</button></div>
<div class="row"><button id="run">run last recipe</button><button id="stop">stop</button></div>
<div class="row"><button id="lc">login claude</button><button id="lx">login codex</button><input id="code" placeholder="claude code"><button id="sc">send code</button></div>
<div id="approvals"></div>
<div id="log"></div></div>
<script>
const agent=new URLSearchParams(location.search).get("agent")||"";
const ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/api/ws/viewer?agent="+encodeURIComponent(agent));
const $=id=>document.getElementById(id);
const send=m=>ws.send(JSON.stringify(m));
const log=t=>{$("log").textContent=t+"\\n"+$("log").textContent.slice(0,20000)};
let fw=1280,fh=800,rec="";
ws.onmessage=e=>{const m=JSON.parse(e.data);
 if(m.type==="frame"){$("screen").src="data:image/jpeg;base64,"+m.jpegBase64;fw=m.width;fh=m.height;$("url").placeholder=m.url;return}
 if(m.type==="state"){$("state").textContent=m.state+(m.note?" ("+m.note+")":"")}
 if(m.type==="approval_request"){const d=document.createElement("div");d.textContent=m.request.summary+" "+JSON.stringify(m.request.fields)+" ";
  for(const ok of [true,false]){const b=document.createElement("button");b.textContent=ok?"approve":"deny";b.onclick=()=>{send({type:"approval_answer",requestId:m.request.id,approved:ok});d.remove()};d.appendChild(b)}
  $("approvals").appendChild(d)}
 if(m.type==="login_prompt"&&m.url){log("LOGIN: "+m.url+(m.code?" code "+m.code:""))}
 if(m.type==="recorded"&&m.event.kind==="screenshot")return;
 log(JSON.stringify(m).slice(0,600))};
const pos=e=>{const r=$("screen").getBoundingClientRect();return{x:Math.round((e.clientX-r.left)*fw/r.width),y:Math.round((e.clientY-r.top)*fh/r.height)}};
let lastMove=0;
$("screen").onmousemove=e=>{if(Date.now()-lastMove<50)return;lastMove=Date.now();send({type:"input",event:{kind:"mouse",action:"move",...pos(e)}})};
$("screen").onmousedown=e=>{$("screen").focus();send({type:"input",event:{kind:"mouse",action:"down",button:e.button===2?"right":"left",...pos(e)}});e.preventDefault()};
$("screen").onmouseup=e=>send({type:"input",event:{kind:"mouse",action:"up",button:e.button===2?"right":"left",...pos(e)}});
$("screen").onwheel=e=>{send({type:"input",event:{kind:"mouse",action:"wheel",deltaY:e.deltaY,...pos(e)}});e.preventDefault()};
$("screen").onkeydown=e=>{send({type:"input",event:{kind:"key",action:"down",key:e.key,code:e.code,text:e.key.length===1?e.key:undefined}});e.preventDefault()};
$("screen").onkeyup=e=>{send({type:"input",event:{kind:"key",action:"up",key:e.key,code:e.code}});e.preventDefault()};
$("screen").onpaste=e=>{send({type:"input",event:{kind:"key",action:"char",key:"",text:e.clipboardData.getData("text")}})};
$("go").onclick=()=>send({type:"input",event:{kind:"navigate",url:$("url").value}});
$("send").onclick=()=>{send({type:"chat",text:$("chat").value,from:"Dev"});log("you: "+$("chat").value);$("chat").value=""};
$("recStart").onclick=()=>{rec="rec-"+Date.now();send({type:"record_start",recordingId:rec})};
$("recStop").onclick=()=>send({type:"record_stop",recordingId:rec});
$("narrate").onclick=()=>{send({type:"record_narration",recordingId:rec,text:$("narr").value});$("narr").value=""};
$("run").onclick=()=>send({type:"run_last"});
$("stop").onclick=()=>send({type:"stop"});
$("lc").onclick=()=>send({type:"login_start",brain:"claude"});
$("lx").onclick=()=>send({type:"login_start",brain:"codex"});
$("sc").onclick=()=>send({type:"login_code",brain:"claude",code:$("code").value});
</script></body></html>`;
