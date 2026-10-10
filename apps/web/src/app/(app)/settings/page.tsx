import { connectSlackAccount } from "@/app/actions/slack";
import { PushToggle } from "@/components/PushToggle";
import { SlackDisconnect } from "@/components/SlackDisconnect";
import { SettingsSection } from "@/components/ui/Section";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { vapidKeys } from "@/server/push";
import { slackEnabled, slackUserName } from "@/server/slack";
import { linkedSlackUser, readSlackLinkToken } from "@/server/slack-link";

const t = messages.settings;

async function slackState(userId: string, token: string | undefined) {
  if (!(await slackEnabled())) return null;
  const offered = token && token !== "expired" ? readSlackLinkToken(token) : null;
  const linked = await linkedSlackUser(userId);
  const nameOf = async (id: string) => (await slackUserName(id).catch(() => null)) ?? id;
  return {
    offer: offered && offered !== linked ? { token: token as string, name: await nameOf(offered) } : null,
    expired: Boolean(token) && !offered,
    linked: linked ? await nameOf(linked) : null,
  };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ slack?: string }> }) {
  const user = await requireUser();
  const { publicKey } = await vapidKeys();
  const { slack: token } = await searchParams;
  const slack = await slackState(user.id, token);
  return (
    <div className="page">
      <div className="top">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="page-body set-page">
        <SettingsSection id="push" title={t.pushTitle} hint={t.pushBody}>
          <PushToggle publicKey={publicKey} />
        </SettingsSection>
        {slack && (
          <SettingsSection id="slack" title={t.slackTitle} hint={t.slackBody}>
            {slack.expired && <p className="m-0 text-[13px] text-coral">{t.slackExpired}</p>}
            {slack.offer ? (
              <form action={connectSlackAccount} className="flex flex-col gap-2.5">
                <input type="hidden" name="token" value={slack.offer.token} />
                <p className="m-0 text-[13px]">{t.slackConfirm(slack.offer.name)}</p>
                <button type="submit" className="btn pri self-start">
                  {t.slackConnect}
                </button>
              </form>
            ) : slack.linked ? (
              <div className="flex flex-col gap-2.5">
                <p className="m-0 text-[13px]">{t.slackLinked(slack.linked)}</p>
                <div className="self-start">
                  <SlackDisconnect />
                </div>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-ash">{t.slackByEmail}</p>
            )}
          </SettingsSection>
        )}
        <SettingsSection id="install" title={t.installTitle} hint={t.installBody}>
          <ul className="card rows">
            <li className="row">{t.installIphone}</li>
            <li className="row">{t.installAndroid}</li>
          </ul>
        </SettingsSection>
      </div>
    </div>
  );
}
