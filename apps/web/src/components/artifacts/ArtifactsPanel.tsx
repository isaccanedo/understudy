import { Code2, FileText, Image as ImageIcon, LoaderCircle, Presentation } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ArtifactKind } from "@understudy/protocol";
import { agentArtifacts, artifactView } from "@/app/actions/artifacts";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Look } from "@/lib/look";
import { currentLocale, messages } from "@/lib/messages";
import type { ArtifactSummary, ArtifactView } from "@/server/artifacts/service";
import type { ViewerToServer } from "@/server/hub-types";
import { ARTIFACT_EVENT, artifactSearch, formatLabel, readArtifactAddress, type ArtifactAddress } from "./artifact-ui";
import { ArtifactViewer } from "./ArtifactViewer";

const t = messages.artifacts;

const KIND_ICON: Record<ArtifactKind, typeof FileText> = { html: Code2, markdown: FileText, pages: Presentation, image: ImageIcon };

const FILTERS: (ArtifactKind | "all")[] = ["all", "pages", "markdown", "html", "image"];

export function KindIcon({ kind, size = 16 }: { kind: ArtifactKind; size?: number }) {
  const Icon = KIND_ICON[kind] ?? FileText;
  return <Icon size={size} aria-hidden />;
}

function dayOf(iso: string) {
  return new Date(iso).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
}

export function openArtifact(address: ArtifactAddress) {
  const next = `${window.location.pathname}${artifactSearch(window.location.search, address)}`;
  window.history.pushState(null, "", next);
}

function ArtifactTile({ item, onOpen }: { item: ArtifactSummary; onOpen: () => void }) {
  return (
    <button type="button" className="art-tile" onClick={onOpen} aria-label={t.open(item.title)}>
      <span className="art-tile-preview">
        <span className="art-kind">
          <KindIcon kind={item.kind} size={12} />
          {formatLabel(item.kind, item.name)}
        </span>
        {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <KindIcon kind={item.kind} size={34} />}
      </span>
      <span className="art-tile-meta">
        <span className="min-w-0 flex-1">
          <span className="art-tile-title">{item.title}</span>
          <span className="art-tile-line" suppressHydrationWarning>
            {dayOf(item.updatedAt)}
          </span>
        </span>
        <span className={`art-pill ${item.latestVersion > 1 ? "is-new" : ""}`}>v{item.latestVersion}</span>
      </span>
    </button>
  );
}

export function useArtifactList(agentId: string) {
  const [items, setItems] = useState<ArtifactSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    agentArtifacts(agentId)
      .then((next) => {
        setItems(next);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [agentId]);
  useEffect(() => {
    load();
    window.addEventListener(ARTIFACT_EVENT, load);
    return () => window.removeEventListener(ARTIFACT_EVENT, load);
  }, [load]);
  return { items, failed };
}

function useArtifactView(agentId: string, address: ArtifactAddress | null) {
  const [state, setState] = useState<{ key: string; view: ArtifactView | null; failed?: boolean } | null>(null);
  const key = address ? `${address.artifactId}:${address.version ?? "latest"}` : "";
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!address) return;
    const onEvent = () => setBump((b) => b + 1);
    window.addEventListener(ARTIFACT_EVENT, onEvent);
    return () => window.removeEventListener(ARTIFACT_EVENT, onEvent);
  }, [address]);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    artifactView(agentId, address.artifactId, address.version ?? undefined)
      .then((view) => alive && setState({ key, view }))
      .catch(() => alive && setState({ key, view: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [agentId, address?.artifactId, address?.version, key, bump]);
  return state && state.key === key ? state : null;
}

export function ArtifactsPanel({
  agentId,
  agentName,
  look,
  owner,
  send,
}: {
  agentId: string;
  agentName: string;
  look: Look;
  owner: boolean;
  send?: (message: ViewerToServer) => boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const address = readArtifactAddress(new URLSearchParams(params.toString()));
  const { items, failed } = useArtifactList(agentId);
  const opened = useArtifactView(agentId, address);
  const [filter, setFilter] = useState<ArtifactKind | "all">("all");

  const go = (next: ArtifactAddress | null) => window.history.pushState(null, "", `${pathname}${artifactSearch(params.toString(), next)}`);

  if (address) {
    if (!opened) {
      return (
        <div className="art-loading" role="status">
          <LoaderCircle size={16} className="cx-spin" aria-hidden /> {t.loading}
        </div>
      );
    }
    if (!opened.view) {
      return (
        <div className="art-loading" role="status">
          <span>{opened.failed ? t.loadFailed : t.gone}</span>
          <button type="button" className="art-link-btn" onClick={() => go(null)}>
            {t.back}
          </button>
        </div>
      );
    }
    return (
      <ArtifactViewer
        view={opened.view}
        agentName={agentName}
        mode="panel"
        owner={owner}
        send={owner ? send : undefined}
        onBack={() => go(null)}
        onSelectVersion={(version) => go({ artifactId: opened.view!.id, version: version === opened.view!.latestVersion ? null : version })}
      />
    );
  }

  if (failed && !items) return <div className="art-loading">{t.loadFailed}</div>;
  if (!items) {
    return (
      <div className="art-loading" role="status">
        <LoaderCircle size={16} className="cx-spin" aria-hidden /> {t.loading}
      </div>
    );
  }
  if (items.length === 0) return <EmptyState look={look} mood="happy" title={t.empty} body={t.emptyBody(agentName)} />;

  const kinds = new Set(items.map((item) => item.kind));
  const shown = filter === "all" ? items : items.filter((item) => item.kind === filter);
  return (
    <div className="art-list">
      <p className="art-lead">{t.lead(agentName)}</p>
      {kinds.size > 1 && (
        <div className="art-filters" role="group" aria-label={t.title}>
          {FILTERS.filter((f) => f === "all" || kinds.has(f)).map((f) => (
            <button key={f} type="button" className={`art-filter ${filter === f ? "is-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? t.all : t.kinds[f]}
            </button>
          ))}
        </div>
      )}
      <div className="art-grid">
        {shown.map((item) => (
          <ArtifactTile key={item.id} item={item} onOpen={() => go({ artifactId: item.id, version: null })} />
        ))}
      </div>
    </div>
  );
}
