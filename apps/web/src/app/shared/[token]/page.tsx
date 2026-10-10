import type { Metadata } from "next";
import { SharedArtifact } from "@/components/artifacts/SharedArtifact";
import { env } from "@/lib/env";
import { messages } from "@/lib/messages";
import { sharedArtifact } from "@/server/artifacts/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SharedArtifactPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await sharedArtifact(token);
  if (!shared) {
    return (
      <main className="art-shared is-missing">
        <p>{messages.artifacts.sharedMissing}</p>
      </main>
    );
  }
  const { agentName, ...view } = shared;
  return (
    <main className="art-shared">
      <SharedArtifact view={view} agentName={agentName} />
      <p className="art-shared-foot">{messages.artifacts.sharedFoot(env.productName)}</p>
    </main>
  );
}
