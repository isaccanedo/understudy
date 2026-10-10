import { PencilLine } from "lucide-react";
import type { MessageArtifact } from "@/lib/db/schema";
import { messages } from "@/lib/messages";
import { formatLabel } from "./artifact-ui";
import { KindIcon, openArtifact } from "./ArtifactsPanel";

const t = messages.artifacts;

export function ArtifactCard({ artifact, onOpen }: { artifact: MessageArtifact; onOpen?: () => void }) {
  const open = () => {
    openArtifact({ artifactId: artifact.artifactId, version: artifact.version });
    onOpen?.();
  };
  const detail = [formatLabel(artifact.kind, artifact.name), artifact.pages > 0 ? t.pageCount(artifact.pages) : null, artifact.version > 1 ? t.updated : null].filter(Boolean).join(" · ");
  return (
    <button type="button" className="art-card" onClick={open} aria-label={t.open(artifact.title)}>
      <span className={`art-card-icon is-${artifact.kind}`}>
        <KindIcon kind={artifact.kind} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="art-card-title">{artifact.title}</span>
        <span className="art-card-line">{detail}</span>
      </span>
      <span className={`art-pill ${artifact.version > 1 ? "is-new" : ""}`}>v{artifact.version}</span>
    </button>
  );
}

export function ArtifactEditChip({ artifact, onOpen }: { artifact: MessageArtifact; onOpen?: () => void }) {
  const quote = artifact.edit?.quote;
  const page = artifact.edit?.page;
  return (
    <button
      type="button"
      className="art-edit-chip"
      onClick={() => {
        openArtifact({ artifactId: artifact.artifactId, version: artifact.version });
        onOpen?.();
      }}
    >
      <span className="art-edit-chip-head">
        <PencilLine size={12} aria-hidden />
        {t.editChip(artifact.title, artifact.version)}
        {page ? ` · ${t.editChipPage(page)}` : ""}
      </span>
      {quote && <span className="art-edit-chip-quote">{quote}</span>}
    </button>
  );
}
