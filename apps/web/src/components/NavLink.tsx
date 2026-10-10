"use client";

import { Bot, CalendarDays, Inbox, LayoutTemplate, ListChecks, MessagesSquare, Puzzle, Settings, UserCog, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  today: CalendarDays,
  agents: Bot,
  waiting: Inbox,
  tasks: ListChecks,
  templates: LayoutTemplate,
  settings: Settings,
  team: UsersRound,
  rooms: MessagesSquare,
  people: UserCog,
  extension: Puzzle,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;

export function NavLink({ href, children, exact = false, icon, badge }: { href: string; children: React.ReactNode; exact?: boolean; icon?: NavIcon; badge?: number }) {
  const pathname = usePathname();
  const on = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const Icon = icon ? ICONS[icon] : null;
  return (
    <Link href={href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
      <span className="nav-label">
        {Icon && <Icon size={16} strokeWidth={1.8} aria-hidden />}
        {children}
      </span>
      {badge ? <span className="n">{badge}</span> : null}
    </Link>
  );
}
