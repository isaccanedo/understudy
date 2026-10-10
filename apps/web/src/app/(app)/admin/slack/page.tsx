import Link from "next/link";
import { SlackConfigForm } from "@/components/approvals/SlackConfigForm";
import { env } from "@/lib/env";
import { messages } from "@/lib/messages";
import { requireAdmin } from "@/lib/session";
import { missingScopes, slackManifest, slackManifestUrl } from "@/server/slack-app";
import { grantedSlackScopes, slackConfig } from "@/server/slack";

const t = messages.slackAdmin;

export default async function SlackAdminPage() {
  await requireAdmin();
  const config = await slackConfig();
  const manifest = slackManifest({ productName: env.productName, publicUrl: env.publicUrl, description: messages.product.tagline });
  const httpsReady = env.publicUrl.startsWith("https://");
  const granted = config ? await grantedSlackScopes() : null;
  const missing = granted ? missingScopes(granted) : [];
  return (
    <div className="page narrow">
      <div className="top">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <Link href="/admin" className="btn sec sm">
          {messages.common.back}
        </Link>
      </div>
      <div className="flex flex-col gap-5 py-6">
        <section className="card p-[18px] flex flex-col gap-2.5">
          <h3 className="m-0 text-[14px] font-semibold">{t.statusTitle}</h3>
          <p className="m-0 text-[13px] text-ash">
            {config ? (config.source === "panel" ? t.connected(config.teamName ?? "") : config.signingSecret ? t.fromEnv : t.fromEnvNoButtons) : t.notConnected}
          </p>
          {missing.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-graphite pt-2.5" role="status">
              <p className="m-0 text-[13px] text-coral">{t.missingScopes(missing.length)}</p>
              <p className="m-0 text-[12.5px] text-ash">{t.missingScopesHow}</p>
              <div className="flex flex-wrap gap-1.5">
                {missing.map((scope) => (
                  <span key={scope} className="pill font-mono">
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="card p-[18px] flex flex-col gap-2.5">
          <h3 className="m-0 text-[14px] font-semibold">{t.step1}</h3>
          <p className="m-0 text-[13px] text-ash">{t.step1Body}</p>
          {!httpsReady && <p className="m-0 text-[12.5px] text-coral">{t.needsHttps(env.publicUrl)}</p>}
          <a className="btn pri self-start" href={slackManifestUrl(manifest)} target="_blank" rel="noreferrer">
            {t.createApp}
          </a>
        </section>
        <section className="card p-[18px] flex flex-col gap-2.5">
          <h3 className="m-0 text-[14px] font-semibold">{t.step2}</h3>
          <p className="m-0 text-[13px] text-ash">{t.step2Body}</p>
          <SlackConfigForm connected={config?.source === "panel"} />
        </section>
        <section className="card p-[18px] flex flex-col gap-2">
          <h3 className="m-0 text-[14px] font-semibold">{t.howTitle}</h3>
          <ul className="m-0 pl-5 text-[13px] text-ash flex flex-col gap-1">
            {t.how.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
