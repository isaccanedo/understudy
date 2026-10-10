import Link from "next/link";
import type { ReactNode } from "react";
import { AgentFigure } from "@/components/AgentFigure";
import type { Look } from "@/lib/look";
import { cx } from "./controls";

export type EmptyMood = "calm" | "happy" | "curious" | "sleepy" | "waiting";

const MOODS: Record<EmptyMood, Partial<Look>> = {
  calm: { body: "cloud", color: "#3ECF8E", eyes: "neutral" },
  happy: { body: "cloud", color: "#3ECF8E", eyes: "happy" },
  curious: { body: "squircle", color: "#8B6CF6", eyes: "curious" },
  sleepy: { body: "pebble", color: "#3B93F0", eyes: "sleepy" },
  waiting: { body: "hexagon", color: "#2EC4C6", eyes: "attentive" },
};

export type EmptyAction = { href: string; label: string; secondary?: boolean };

export function EmptyState({
  title,
  body,
  action,
  look,
  mood = "calm",
  size = "md",
  framed = false,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: EmptyAction | ReactNode;
  look?: Partial<Look> | null;
  mood?: EmptyMood;
  size?: "sm" | "md";
  framed?: boolean;
  className?: string;
}) {
  const link = action && typeof action === "object" && "href" in action ? (action as EmptyAction) : null;
  return (
    <div className={cx("empty", size === "sm" && "sm", framed && "card is-framed", className)}>
      <div className="empty-figure" aria-hidden>
        <AgentFigure size={size === "sm" ? 52 : 84} look={look ? { ...look, eyes: MOODS[mood].eyes } : MOODS[mood]} live={false} />
      </div>
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {link ? (
        <Link href={link.href} className={cx("btn", link.secondary ? "sec" : "pri", size === "sm" && "sm", "empty-action")}>
          {link.label}
        </Link>
      ) : action ? (
        <div className="empty-action">{action as ReactNode}</div>
      ) : null}
    </div>
  );
}
