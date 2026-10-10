"use client";

import type { ArtifactView } from "@/server/artifacts/service";
import { ArtifactViewer } from "./ArtifactViewer";

export function SharedArtifact({ view, agentName }: { view: ArtifactView; agentName: string }) {
  return <ArtifactViewer view={view} agentName={agentName} mode="public" />;
}
