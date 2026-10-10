"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./controls";

export type Choice<T extends string> = { value: T; label: ReactNode };

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  variant = "track",
  className,
}: {
  label: string;
  options: Choice<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
  variant?: "track" | "chips";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((option) => option.value === value);
  const focusable = selected === -1 ? 0 : selected;
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={cx("seg", variant === "chips" && "chips", className)}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === focusable ? 0 : -1}
          disabled={disabled}
          className="seg-opt"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
