"use client";

import { useTransition } from "react";
import { disconnectSlackAccount } from "@/app/actions/slack";
import { ConfirmButton } from "@/components/ConfirmButton";
import { messages } from "@/lib/messages";

const t = messages.settings;

export function SlackDisconnect() {
  const [pending, start] = useTransition();
  return <ConfirmButton label={t.slackDisconnect} question={t.slackDisconnectConfirm} disabled={pending} onConfirm={() => start(() => disconnectSlackAccount())} />;
}
