"use client";

import { useEffect, useState } from "react";
import { subscribePush, unsubscribePush } from "@/app/actions/notifications";
import { messages } from "@/lib/messages";
import { Switch } from "@/components/ui/controls";

const t = messages.settings;

type State = "loading" | "unsupported" | "denied" | "off" | "on" | "busy";

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    registration()
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function turnOn() {
    setState("busy");
    setError(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const result = await subscribePush({ endpoint: json.endpoint, keys: json.keys });
      if (!result.ok) throw new Error("subscribe failed");
      setState("on");
    } catch {
      setError(true);
      setState("off");
    }
  }

  async function turnOff() {
    setState("busy");
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }

  if (state === "unsupported") return <div className="text-smoke text-[12.5px]">{t.pushUnsupported}</div>;
  if (state === "denied") return <div className="text-smoke text-[12.5px]">{t.pushDenied}</div>;
  const on = state === "on";
  return (
    <Switch
      label={t.pushSwitch}
      hint={error ? <span className="text-coral">{t.pushFailed}</span> : undefined}
      checked={on}
      disabled={state === "loading" || state === "busy"}
      onChange={on ? turnOff : turnOn}
    />
  );
}
