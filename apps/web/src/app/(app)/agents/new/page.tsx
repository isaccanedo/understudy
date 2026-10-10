import { AgentForm } from "@/components/create/AgentForm";
import { randomLook } from "@/lib/look";
import { serverOptions } from "@/lib/server-options";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { slackEnabled } from "@/server/slack";

export default async function NewAgentPage() {
  const user = await requireUser();
  const servers = await serverOptions(user);
  return (
    <div className="page">
      <div className="top">
        <div>
          <h1>{messages.create.title}</h1>
          <p>{messages.create.subtitle}</p>
        </div>
      </div>
      <AgentForm
        slackAvailable={await slackEnabled()}
        servers={servers}
        admin={Boolean(user.admin)}
        initial={{
          name: "",
          role: "",
          look: randomLook(),
          brain: "claude",
          tools: { notifyOwner: true, slack: false, slackChannels: [], slackMode: "ask", servers: [], askTools: [] },
        }}
      />
    </div>
  );
}
