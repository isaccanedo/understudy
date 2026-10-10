import type { ComponentProps, ReactNode } from "react";

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

type Size = "md" | "sm";

export function Field({ label, hint, error, className, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cx("fld", className)}>
      <span className="fld-label">{label}</span>
      {children}
      {hint && <span className="fld-hint">{hint}</span>}
      {error && (
        <span className="fld-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function FieldGroup({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cx("fld", className)} role="group" aria-label={typeof label === "string" ? label : undefined}>
      <span className="fld-label">{label}</span>
      {children}
      {hint && <span className="fld-hint">{hint}</span>}
    </div>
  );
}

export function Input({ className, size = "md", ...props }: Omit<ComponentProps<"input">, "size"> & { size?: Size }) {
  return <input {...props} className={cx("in", size === "sm" && "sm", className)} />;
}

export function Textarea({ className, size = "md", ...props }: ComponentProps<"textarea"> & { size?: Size }) {
  return <textarea {...props} className={cx("in", size === "sm" && "sm", className)} />;
}

type BoxProps = Omit<ComponentProps<"input">, "type"> & { label: ReactNode; hint?: ReactNode };

export function Switch({ label, hint, className, plain, ...input }: BoxProps & { plain?: boolean }) {
  return (
    <label className={cx("sw-row", plain && "plain", input.disabled && "is-disabled", className)}>
      <span className="sw-text">
        <span>{label}</span>
        {hint && <span className="fld-hint">{hint}</span>}
      </span>
      <input {...input} type="checkbox" role="switch" className="sw-in" />
      <span className="tg" aria-hidden />
    </label>
  );
}

export function Checkbox({ label, hint, className, ...input }: BoxProps) {
  return (
    <label className={cx("ck-row", input.disabled && "is-disabled", className)}>
      <input {...input} type="checkbox" className="ck" />
      <span className="ck-text">
        <span>{label}</span>
        {hint && <span className="fld-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Radio({ label, hint, className, ...input }: BoxProps) {
  return (
    <label className={cx("ck-row", input.disabled && "is-disabled", className)}>
      <input {...input} type="radio" className="ck rd" />
      <span className="ck-text">
        <span>{label}</span>
        {hint && <span className="fld-hint">{hint}</span>}
      </span>
    </label>
  );
}
