"use client";

import { Check, Copy, Download } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { connectedBrowsers, disconnectBrowser, showPairCode, type ConnectedBrowser } from "@/app/actions/extension";
import { formatWhen } from "@/lib/format";
import { messages } from "@/lib/messages";
import { DevModeArt, DownloadArt, LoadArt, OpenArt, PinArt } from "./Illustrations";
import { EmptyState } from "@/components/ui/EmptyState";

const t = messages.extension;
const POLL_MS = 2500;

type Code = { code: string; expiresAt: string };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sec sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? t.copied : label}
    </button>
  );
}

function StepCard({ n, title, done, children, art }: { n: number; title: string; done?: boolean; children: React.ReactNode; art?: React.ReactNode }) {
  return (
    <li className="card p-5 grid grid-cols-[1fr_minmax(0,330px)] gap-6 items-center max-[900px]:grid-cols-1 max-[900px]:p-4 max-[900px]:gap-4">
      <div className="flex flex-col gap-2.5 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className={`w-7 h-7 rounded-full grid place-items-center text-[12.5px] font-semibold flex-none ${done ? "bg-green text-ink" : "bg-white text-ink"}`} aria-hidden>
            {done ? <Check size={15} strokeWidth={2.6} /> : n}
          </span>
          <span className="text-smoke text-[11.5px] uppercase tracking-[.06em] font-semibold">{t.step(n)}</span>
        </div>
        <h3 className="m-0 text-[16px] font-semibold tracking-[-0.02em]">{title}</h3>
        {children}
      </div>
      {art && <div className="min-w-0">{art}</div>}
    </li>
  );
}

function minutesLeft(expiresAt: string, now: number) {
  return Math.ceil((new Date(expiresAt).getTime() - now) / 60000);
}

export function ExtensionGuide({
  initialBrowsers,
  productName,
  folder,
  agent,
}: {
  initialBrowsers: ConnectedBrowser[];
  productName: string;
  folder: string;
  agent: { id: string; name: string } | null;
}) {
  const [browsers, setBrowsers] = useState(initialBrowsers);
  const [code, setCode] = useState<Code | null>(null);
  const [codeAt, setCodeAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const pairedSinceCode = codeAt !== null && browsers.some((browser) => new Date(browser.createdAt).getTime() >= codeAt - 5000);
  const connected = browsers.length > 0;
  const expired = code !== null && minutesLeft(code.expiresAt, now) <= 0;

  const refresh = useCallback(async () => {
    const next = await connectedBrowsers().catch(() => null);
    if (next) setBrowsers(next);
  }, []);

  useEffect(() => {
    if (!code || pairedSinceCode || expired) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [code, pairedSinceCode, expired, refresh]);

  useEffect(() => {
    if (pairedSinceCode) setCode(null);
  }, [pairedSinceCode]);

  async function newCode() {
    setBusy(true);
    try {
      const next = await showPairCode();
      setCode(next);
      setCodeAt(Date.now());
      setNow(Date.now());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="card px-5 py-4 flex items-center gap-3 flex-wrap" role="status" aria-live="polite">
        <span className={`w-9 h-9 rounded-full grid place-items-center flex-none ${connected ? "bg-[#12271d] text-green" : "bg-graphite text-smoke"}`} aria-hidden>
          <Check size={18} strokeWidth={2.6} />
        </span>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold ${connected ? "text-green" : "text-mist"}`}>{connected ? t.connected : t.notConnected}</div>
          <div className="text-[12.5px] text-ash">{pairedSinceCode ? t.connectedJustNow : connected ? browsers.map((browser) => browser.label || "Chrome").join(" · ") : t.setupBody}</div>
        </div>
        {!connected && (
          <a className="btn pri" href="#pair">
            {t.pairTitle}
          </a>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-[18px] font-semibold tracking-[-0.02em]">{t.setupTitle}</h2>
        <ol className="list-none m-0 p-0 flex flex-col gap-3">
          <StepCard n={1} title={t.downloadTitle} art={<DownloadArt folder={folder} />}>
            <p className="m-0 text-[13.5px] text-ash">{t.downloadBody(folder)}</p>
            <a className="btn pri self-start" href="/api/extension/package.zip" download>
              <Download size={15} aria-hidden />
              {t.download}
            </a>
          </StepCard>
          <StepCard n={2} title={t.openTitle} art={<OpenArt />}>
            <p className="m-0 text-[13.5px] text-ash">{t.openBody}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="rounded-[10px] bg-[rgb(8_9_14/.5)] border border-line px-3 py-1.5 text-[13px] text-mist">chrome://extensions</code>
              <CopyButton text="chrome://extensions" label={t.copy} />
            </div>
          </StepCard>
          <StepCard n={3} title={t.devTitle} art={<DevModeArt />}>
            <p className="m-0 text-[13.5px] text-ash">{t.devBody}</p>
          </StepCard>
          <StepCard n={4} title={t.loadTitle} art={<LoadArt />}>
            <p className="m-0 text-[13.5px] text-ash">{t.loadBody(folder)}</p>
          </StepCard>
          <StepCard n={5} title={t.pinTitle} art={<PinArt productName={productName} />}>
            <p className="m-0 text-[13.5px] text-ash">{t.pinBody}</p>
          </StepCard>
          <li id="pair" className="card p-5 flex flex-col gap-3 max-[900px]:p-4 scroll-mt-6">
            <div className="flex items-center gap-2.5">
              <span className={`w-7 h-7 rounded-full grid place-items-center text-[12.5px] font-semibold ${connected ? "bg-green text-ink" : "bg-white text-ink"}`} aria-hidden>
                {connected ? <Check size={15} strokeWidth={2.6} /> : 6}
              </span>
              <span className="text-smoke text-[11.5px] uppercase tracking-[.06em] font-semibold">{t.step(6)}</span>
            </div>
            <h3 className="m-0 text-[16px] font-semibold tracking-[-0.02em]">{t.pairTitle}</h3>
            <p className="m-0 text-[13.5px] text-ash">{t.pairBody}</p>
            {code && !expired && (
              <div className="flex items-center gap-4 flex-wrap">
                <div className="rounded-[16px] bg-[rgb(8_9_14/.5)] border border-line px-5 py-3 text-[28px] font-semibold tracking-[.14em] text-white tabular-nums" aria-label={code.code.split("").join(" ")}>
                  {code.code}
                </div>
                <div className="flex flex-col gap-1.5">
                  <CopyButton text={code.code} label={t.copy} />
                  <span className="text-[12px] text-smoke">{t.codeExpires(minutesLeft(code.expiresAt, now))}</span>
                </div>
                <span className="flex items-center gap-2 text-[12.5px] text-ash">
                  <span className="rec-dot on" style={{ background: "var(--sky)", boxShadow: "0 0 0 4px rgb(99 161 255 / .2)" }} aria-hidden />
                  {t.waiting}
                </span>
              </div>
            )}
            {expired && <div className="err">{t.codeExpired}</div>}
            {pairedSinceCode && <div className="text-green text-[13px] font-medium">{t.connectedJustNow}</div>}
            <button type="button" className={`btn ${code && !expired ? "sec" : "pri"} self-start`} disabled={busy} onClick={newCode}>
              {code || connected ? t.anotherCode : t.newCode}
            </button>
          </li>
        </ol>
      </section>

      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        <section className="card p-5 flex flex-col gap-2.5">
          <h2 className="m-0 text-[15px] font-semibold">{t.howTitle}</h2>
          <ol className="m-0 pl-5 flex flex-col gap-1.5 text-[13px] text-ash">
            {t.how.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>
        <section className="card p-5 flex flex-col gap-2.5">
          <h2 className="m-0 text-[15px] font-semibold">{t.privacyTitle}</h2>
          <ul className="m-0 pl-5 flex flex-col gap-1.5 text-[13px] text-ash">
            {t.privacy.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-5 flex flex-col gap-3">
        <h2 className="m-0 text-[15px] font-semibold">{t.browsersTitle}</h2>
        {browsers.length === 0 && <EmptyState size="sm" mood="sleepy" title={messages.empty.browsersTitle} body={messages.empty.browsersBody} />}
        {browsers.map((browser) => (
          <div key={browser.id} className="flex items-center gap-3 border-t border-line pt-3 first-of-type:border-0 first-of-type:pt-0">
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] text-mist truncate">{browser.label || "Chrome"}</div>
              <div className="text-[12px] text-smoke">{t.lastUsed(formatWhen(browser.lastUsedAt))}</div>
            </div>
            <button type="button" className="btn sec sm" onClick={async () => setBrowsers(await disconnectBrowser(browser.id))}>
              {t.disconnect}
            </button>
          </div>
        ))}
      </section>

      {agent && (
        <section className="card p-5 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="m-0 text-[15px] font-semibold">{t.remoteTitle}</h2>
            <p className="m-0 text-[13px] text-ash">{t.remoteBody}</p>
          </div>
          <Link className="btn sec" href={`/agents/${agent.id}/teach?mode=remote`}>
            {t.remoteLink(agent.name)}
          </Link>
        </section>
      )}
    </div>
  );
}
