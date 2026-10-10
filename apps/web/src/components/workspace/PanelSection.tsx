"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/controls";

export function PanelSection({
  title,
  hint,
  aside,
  collapsible = false,
  danger = false,
  children,
}: {
  title: string;
  hint?: ReactNode;
  aside?: ReactNode;
  collapsible?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible);
  const bodyId = useId();
  const hintId = useId();
  const heading = (
    <span className="min-w-0 flex-1">
      <span className="st-title">{title}</span>
      {hint && (
        <span id={hintId} className="st-hint">
          {hint}
        </span>
      )}
    </span>
  );
  return (
    <section className={cx("card st", danger && "is-danger")} aria-label={title}>
      {collapsible ? (
        <button type="button" className="st-head is-toggle" aria-label={title} aria-describedby={hint ? hintId : undefined} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          {heading}
          <ChevronDown size={16} className="st-chev" aria-hidden />
        </button>
      ) : (
        <div className="st-head">
          {heading}
          {aside}
        </div>
      )}
      <div id={bodyId} hidden={!open} className="st-body">
        {children}
      </div>
    </section>
  );
}
