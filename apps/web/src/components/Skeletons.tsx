import { messages } from "@/lib/messages";

function Bone({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={`sk block ${className}`} style={style} />;
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{messages.common.loading}</span>
      {children}
    </div>
  );
}

function Top({ action = true }: { action?: boolean }) {
  return (
    <div className="top">
      <div className="flex flex-col gap-2.5 min-w-0 w-full max-w-[520px]">
        <Bone className="h-[26px] w-[220px] rounded-[8px]" />
        <Bone className="h-[13px] w-full max-w-[420px] rounded-[6px]" />
      </div>
      {action && <Bone className="h-[38px] w-[150px] rounded-full flex-none max-[900px]:hidden" />}
    </div>
  );
}

export function CardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Status>
      <div className="page wide">
      <Top />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 py-6">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="card p-3 flex flex-col gap-3">
            <div className="figure-stage h-[150px]" style={{ "--tint": "#8b8c8d" } as React.CSSProperties}>
              <Bone className="h-[96px] w-[96px] rounded-full" />
            </div>
            <div className="px-2 flex flex-col gap-2">
              <Bone className="h-[16px] w-[60%] rounded-[6px]" />
              <Bone className="h-[12px] w-[80%] rounded-[6px]" />
            </div>
            <div className="mx-2 flex flex-col gap-1.5 min-h-[38px]">
              <Bone className="h-[12px] w-full rounded-[6px]" />
              <Bone className="h-[12px] w-[70%] rounded-[6px]" />
            </div>
            <div className="mx-2 mb-1 pt-2.5 border-t border-line">
              <Bone className="h-[11px] w-[40%] rounded-[6px]" />
            </div>
          </div>
        ))}
      </div>
      </div>
    </Status>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Status>
      <div className="page narrow">
      <Top />
      <div className="flex flex-col gap-4 py-5">
        <div className="flex gap-2">
          {[64, 84, 72].map((width) => (
            <Bone key={width} className="h-[24px] rounded-full" style={{ width }} />
          ))}
        </div>
        <div className="card overflow-hidden">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-[18px] py-3.5 border-t border-graphite first:border-0">
              <Bone className="h-[30px] w-[30px] rounded-full flex-none" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <Bone className="h-[13px] rounded-[6px]" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                <Bone className="h-[11px] w-[30%] rounded-[6px]" />
              </div>
              <Bone className="h-[22px] w-[70px] rounded-full flex-none" />
            </div>
          ))}
        </div>
      </div>
      </div>
    </Status>
  );
}

export function AgentSkeleton() {
  return (
    <Status>
      <div className="ap is-card" style={{ "--agent": "#8b8c8d" } as React.CSSProperties}>
        <nav className="ar">
          <div className="ar-brand">
            <Bone className="h-[26px] w-[26px] rounded-full flex-none" />
            <Bone className="h-[15px] w-[96px] rounded-[6px] ar-text" />
          </div>
          <Bone className="h-[38px] w-full rounded-[12px] mb-2.5" />
          <div className="ar-label ar-text">
            <Bone className="h-[10px] w-[110px] rounded-[6px]" />
          </div>
          <div className="flex flex-col gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="ar-agent">
                <Bone className="h-[30px] w-[30px] rounded-full flex-none" />
                <span className="flex-1 min-w-0 flex flex-col gap-1.5 ar-text">
                  <Bone className="h-[12px] rounded-[6px]" style={{ width: `${55 + ((i * 19) % 35)}%` }} />
                  <Bone className="h-[10px] w-[34%] rounded-[6px]" />
                </span>
              </div>
            ))}
          </div>
          <div className="ar-nav">
            {[0, 1].map((i) => (
              <div key={i} className="ar-link">
                <Bone className="h-[16px] w-[16px] rounded-[5px] flex-none" />
                <Bone className="h-[12px] w-[96px] rounded-[6px] ar-text" />
              </div>
            ))}
          </div>
          <div className="ar-who">
            <Bone className="h-[28px] w-[28px] rounded-full flex-none" />
            <Bone className="h-[12px] w-[90px] rounded-[6px] ar-text" />
          </div>
        </nav>
        <section className="cx-col">
          <div className="cx-head">
            <Bone className="h-[34px] w-[34px] rounded-full flex-none" />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <Bone className="h-[15px] w-[150px] rounded-[6px]" />
              <Bone className="h-[11px] w-[120px] rounded-[6px]" />
            </div>
            <Bone className="h-[36px] w-[120px] rounded-full flex-none max-[700px]:w-[36px]" />
            <Bone className="h-[36px] w-[36px] rounded-full flex-none" />
          </div>
          <div className="cx-list overflow-hidden">
            <Bone className="h-[30px] w-[42%] rounded-[16px] self-end" />
            <div className="flex gap-2.5 max-w-[85%]">
              <Bone className="h-[22px] w-[22px] rounded-full flex-none" />
              <div className="flex-1 flex flex-col gap-2">
                <Bone className="h-[11px] w-[120px] rounded-[6px]" />
                <Bone className="h-[13px] w-full rounded-[6px]" />
                <Bone className="h-[13px] w-[80%] rounded-[6px]" />
              </div>
            </div>
            <Bone className="h-[30px] w-[50%] rounded-[16px] self-end" />
            <div className="flex gap-2.5 max-w-[85%]">
              <Bone className="h-[22px] w-[22px] rounded-full flex-none" />
              <div className="flex-1 flex flex-col gap-2">
                <Bone className="h-[11px] w-[110px] rounded-[6px]" />
                <Bone className="h-[13px] w-full rounded-[6px]" />
                <Bone className="h-[13px] w-[65%] rounded-[6px]" />
              </div>
            </div>
          </div>
          <div className="cx-composer">
            <Bone className="h-[14px] w-[45%] rounded-[6px] mx-2.5 mt-3" />
            <div className="flex justify-between items-center px-1.5 pt-4 pb-0.5">
              <Bone className="h-[28px] w-[28px] rounded-full" />
              <Bone className="h-[32px] w-[32px] rounded-full" />
            </div>
          </div>
        </section>
        <aside className="ap-side is-card">
          <div className="ac">
            <div className="ac-hero">
              <Bone className="h-[88px] w-[88px] rounded-[24px] mb-3" />
              <Bone className="h-[18px] w-[140px] rounded-[6px]" />
              <Bone className="h-[12px] w-[220px] max-w-full rounded-[6px] mt-2.5" />
              <Bone className="h-[12px] w-[170px] max-w-full rounded-[6px] mt-1.5" />
              <Bone className="h-[22px] w-[64px] rounded-full mt-3" />
            </div>
            <div className="ac-actions">
              {[0, 1, 2, 3].map((i) => (
                <Bone key={i} className="h-[54px] w-full rounded-[14px]" />
              ))}
            </div>
            <div className="ac-section">
              <div className="flex items-center justify-between px-[18px] pb-2">
                <Bone className="h-[12px] w-[70px] rounded-[6px]" />
                <Bone className="h-[11px] w-[30px] rounded-[6px]" />
              </div>
              <Bone className="mx-3.5 aspect-[16/10] rounded-[14px]" />
            </div>
            <div className="ac-section">
              <div className="flex items-center justify-between px-[18px] pb-2">
                <Bone className="h-[12px] w-[100px] rounded-[6px]" />
                <Bone className="h-[11px] w-[44px] rounded-[6px]" />
              </div>
              <div className="flex items-center gap-2.5 px-[18px]">
                <Bone className="h-[22px] w-[22px] rounded-[7px] flex-none" />
                <Bone className="h-[12px] flex-1 rounded-[6px]" />
              </div>
            </div>
            <div className="ac-section">
              <div className="flex items-center justify-between px-[18px] pb-2">
                <Bone className="h-[12px] w-[64px] rounded-[6px]" />
              </div>
              <Bone className="h-[46px] mx-3.5 rounded-[12px]" />
            </div>
          </div>
        </aside>
      </div>
    </Status>
  );
}

export function GuideSkeleton({ steps = 3 }: { steps?: number }) {
  return (
    <Status>
      <div className="page">
        <Top action={false} />
        <div className="flex flex-col gap-6 py-6">
          <div className="card px-5 py-4 flex items-center gap-3">
            <Bone className="h-9 w-9 rounded-full flex-none" />
            <div className="flex-1 flex flex-col gap-1.5">
              <Bone className="h-[14px] w-[110px] rounded-[6px]" />
              <Bone className="h-[11px] w-[160px] rounded-[6px]" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Bone className="h-[18px] w-[140px] rounded-[6px]" />
            {Array.from({ length: steps }, (_, i) => (
              <div key={i} className="card p-5 grid grid-cols-[1fr_minmax(0,330px)] gap-6 items-center max-[900px]:grid-cols-1 max-[900px]:p-4 max-[900px]:gap-4">
                <div className="flex flex-col gap-2.5 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <Bone className="h-7 w-7 rounded-full flex-none" />
                    <Bone className="h-[11px] w-[54px] rounded-[6px]" />
                  </div>
                  <Bone className="h-[16px] w-[220px] max-w-full rounded-[6px]" />
                  <Bone className="h-[12px] w-full rounded-[6px]" />
                  <Bone className="h-[12px] w-[75%] rounded-[6px]" />
                  <Bone className="h-[38px] w-[190px] rounded-full mt-1" />
                </div>
                <Bone className="h-[112px] w-full rounded-[14px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Status>
  );
}
