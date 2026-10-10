import "@xterm/xterm/css/xterm.css";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentLink } from "@/components/live/useAgentSocket";
import { messages } from "@/lib/messages";

const t = messages.terminal;

type XTerm = import("@xterm/xterm").Terminal;
type Fit = import("@xterm/addon-fit").FitAddon;

function readStored(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {}
}

function newTerminalId() {
  return `term_${Math.random().toString(36).slice(2, 12)}`;
}

export function TerminalPane({ agentId, agentName, link, active }: { agentId: string; agentName: string; link: AgentLink; active: boolean }) {
  const { live, send, listen } = link;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<Fit | null>(null);
  const idRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "offline">("connecting");
  const [ready, setReady] = useState(false);
  const storageKey = `understudy-terminal-${agentId}`;

  useEffect(
    () =>
      listen({
        onTerminal: (message) => {
          if (message.terminalId !== idRef.current) return;
          if (message.type === "terminal_output") {
            termRef.current?.write(message.data);
            setStatus("open");
          } else {
            termRef.current?.write(`\r\n\x1b[2m${t.ended}\x1b[0m\r\n`);
            idRef.current = null;
            writeStored(storageKey, null);
            setStatus("closed");
          }
        },
      }),
    [listen, storageKey],
  );

  const open = useCallback((fresh: boolean) => {
    const term = termRef.current;
    if (!term) return;
    if (fresh && idRef.current) send({ type: "terminal_close", terminalId: idRef.current });
    let terminalId = fresh ? null : readStored(storageKey);
    if (!terminalId) {
      terminalId = newTerminalId();
      writeStored(storageKey, terminalId);
    }
    idRef.current = terminalId;
    term.reset();
    setStatus("connecting");
    if (!send({ type: "terminal_open", terminalId, cols: term.cols, rows: term.rows })) setStatus("offline");
  }, [send, storageKey]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const fitVisible = () => {
      const host = hostRef.current;
      if (host && host.clientWidth > 0 && host.clientHeight > 0) fitRef.current?.fit();
    };
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        theme: { background: "#07080a", foreground: "#e6e6e6", cursor: "#e6e6e6", selectionBackground: "#363739" },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      termRef.current = term;
      fitRef.current = fit;
      fitVisible();
      term.onData((data) => {
        if (idRef.current) send({ type: "terminal_input", terminalId: idRef.current, data });
      });
      term.onResize(({ cols, rows }) => {
        if (idRef.current) send({ type: "terminal_resize", terminalId: idRef.current, cols, rows });
      });
      observer = new ResizeObserver(fitVisible);
      observer.observe(hostRef.current);
      setReady(true);
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [send]);

  useEffect(() => {
    if (!ready) return;
    if (live.online) open(false);
    else setStatus("offline");
  }, [ready, live.online, open]);

  useEffect(() => {
    if (active && ready) termRef.current?.focus();
  }, [active, ready]);

  return (
    <div className="ws-panel h-full">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="ws-lead flex-1 min-w-[200px] !m-0">{t.hint}</p>
        <div className="flex items-center gap-2">
          <span className={`pill ${status === "open" ? "g" : status === "offline" ? "c" : ""}`}>
            <span className="dot" />
            {t.status[status]}
          </span>
          <button type="button" className="btn sec sm inline-flex items-center gap-1.5" disabled={!live.online} onClick={() => open(true)}>
            <RotateCcw size={14} aria-hidden />
            {t.restart}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-[320px] rounded-xl border border-line bg-ink p-2">
        <div ref={hostRef} className="h-full w-full" aria-label={t.subtitle(agentName)} />
      </div>
    </div>
  );
}
