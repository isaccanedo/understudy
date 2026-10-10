"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteSetting, writeSetting } from "@/lib/app-settings";
import { messages } from "@/lib/messages";
import { requireAdmin, requireUser } from "@/lib/session";
import { linkSlackUser, readSlackLinkToken, unlinkSlackUser } from "@/server/slack-link";
import { forgetSlackConfig, SLACK_SECRET_FIELDS, slackCall } from "@/server/slack";

export async function saveSlackConfig(_: { ok?: boolean; message?: string } | null, form: FormData) {
  const admin = await requireAdmin();
  const botToken = String(form.get("botToken") ?? "").trim();
  const signingSecret = String(form.get("signingSecret") ?? "").trim();
  if (!/^xoxb-[A-Za-z0-9-]{10,}$/.test(botToken) || !/^[a-f0-9]{20,64}$/i.test(signingSecret)) return { ok: false, message: messages.slackAdmin.invalid };
  const check = (await slackCall("auth.test", {}, botToken)) as { ok: boolean; error?: string; team?: string; user_id?: string };
  if (!check.ok) {
    console.error(JSON.stringify({ event: "slack_config_rejected", error: check.error, by: admin.id }));
    return { ok: false, message: messages.slackAdmin.rejected(check.error ?? "") };
  }
  await writeSetting("slack", { botToken, signingSecret, teamName: check.team ?? "", botUserId: check.user_id ?? "" }, SLACK_SECRET_FIELDS);
  forgetSlackConfig();
  console.log(JSON.stringify({ event: "slack_config_saved", team: check.team, by: admin.id }));
  revalidatePath("/admin/slack");
  return { ok: true, message: messages.slackAdmin.saved(check.team ?? "") };
}

export async function removeSlackConfig() {
  const admin = await requireAdmin();
  await deleteSetting("slack");
  forgetSlackConfig();
  console.log(JSON.stringify({ event: "slack_config_removed", by: admin.id }));
  revalidatePath("/admin/slack");
}

export async function connectSlackAccount(form: FormData) {
  const user = await requireUser();
  const slackUserId = readSlackLinkToken(String(form.get("token") ?? ""));
  if (!slackUserId) redirect("/settings?slack=expired#slack");
  await linkSlackUser(user.id, slackUserId);
  console.log(JSON.stringify({ event: "slack_account_linked", userId: user.id }));
  revalidatePath("/settings");
  redirect("/settings#slack");
}

export async function disconnectSlackAccount() {
  const user = await requireUser();
  await unlinkSlackUser(user.id);
  console.log(JSON.stringify({ event: "slack_account_unlinked", userId: user.id }));
  revalidatePath("/settings");
}
