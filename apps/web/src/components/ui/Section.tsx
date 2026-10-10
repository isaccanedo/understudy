import type { ReactNode } from "react";

export function SettingsSection({ id, title, hint, action, children }: { id: string; title: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-sec" aria-labelledby={`${id}-title`}>
      <div className="set-sec-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {hint && <p>{hint}</p>}
        {action}
      </div>
      <div className="set-sec-body">{children}</div>
    </section>
  );
}
