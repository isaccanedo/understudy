"use client";

import { useState } from "react";
import { messages } from "@/lib/messages";

export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  className = "btn sec sm",
  confirmClassName = "btn warn sm",
  disabled,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
  confirmClassName?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={question}>
      <span className="text-[12.5px] text-ash">{question}</span>
      <button
        type="button"
        className={confirmClassName}
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel ?? label}
      </button>
      <button type="button" className="btn sec sm" onClick={() => setAsking(false)}>
        {messages.common.cancel}
      </button>
    </div>
  );
}
