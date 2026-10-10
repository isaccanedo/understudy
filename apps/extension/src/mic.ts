import { copy } from "./copy.ts";

const app = document.getElementById("app") as HTMLElement;
document.documentElement.lang = navigator.language;
document.title = copy.micTitle;

function render(state: "ask" | "done" | "blocked") {
  const title = document.createElement("h1");
  title.textContent = copy.micTitle;
  const body = document.createElement("p");
  body.className = "muted";
  body.textContent = copy.micBody;
  const parts: Node[] = [title, body];
  if (state === "ask") {
    const button = document.createElement("button");
    button.className = "btn pri wide";
    button.type = "button";
    button.textContent = copy.micAllow;
    button.addEventListener("click", () => void request());
    parts.push(button);
  } else {
    const result = document.createElement("p");
    result.className = state === "done" ? "ok" : "err";
    result.setAttribute("role", state === "done" ? "status" : "alert");
    result.textContent = state === "done" ? copy.micDone : copy.micBlocked;
    parts.push(result);
  }
  app.replaceChildren(...parts);
}

async function request() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    render("done");
    setTimeout(() => window.close(), 2500);
  } catch {
    render("blocked");
  }
}

void navigator.permissions
  .query({ name: "microphone" as PermissionName })
  .then((permission) => render(permission.state === "granted" ? "done" : permission.state === "denied" ? "blocked" : "ask"))
  .catch(() => render("ask"));
