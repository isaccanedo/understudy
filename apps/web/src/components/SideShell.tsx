"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { messages } from "@/lib/messages";

export function SideShell({ brand, nav, who, alert }: { brand: React.ReactNode; nav: React.ReactNode; who: React.ReactNode; alert: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <aside className={`side ${open ? "is-open" : ""}`}>
      <div className="side-top">
        {brand}
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="side-menu"
          aria-label={open ? messages.nav.closeMenu : messages.nav.openMenu}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          {!open && alert > 0 && <span className="menu-dot" aria-hidden />}
        </button>
      </div>
      <div id="side-menu" className="side-menu">
        {nav}
        {who}
      </div>
    </aside>
  );
}
