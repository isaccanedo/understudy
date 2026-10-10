"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./controls";
import { edgeIndex, keyIntent, moveIndex, placePopup, selectedIndex, typeahead, type Placement, type SelectOption } from "./select-logic";

export type { SelectOption };

export type SelectItem = SelectOption & { icon?: ReactNode };

export function Select({
  options,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  size = "md",
  className,
  id,
  placeholder,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  options: SelectItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  size?: "md" | "sm";
  className?: string;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const query = useRef({ text: "", at: 0 });
  const base = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const listId = `${base}-list`;
  const optionId = (index: number) => `${base}-opt-${index}`;
  const chosen = options.find((option) => option.value === current);

  const place = useCallback(() => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const natural = list.current ? list.current.scrollHeight + 2 : Math.min(options.length * 44 + 8, 320);
    setPlacement(placePopup({ trigger: rect, viewport: { width: window.innerWidth, height: window.innerHeight }, listHeight: natural }));
  }, [options.length]);

  const show = (to: "selected" | "first" | "last" | number) => {
    if (disabled || options.length === 0) return;
    setActive(typeof to === "number" ? to : to === "selected" ? selectedIndex(options, current) : edgeIndex(options, to));
    setOpen(true);
  };

  const close = (focus = true) => {
    setOpen(false);
    setPlacement(null);
    query.current = { text: "", at: 0 };
    if (focus) trigger.current?.focus();
  };

  const commit = (index: number, focus = true) => {
    const option = options[index];
    if (option && !option.disabled && option.value !== current) {
      if (value === undefined) setInner(option.value);
      onChange?.(option.value);
    }
    close(focus);
  };

  const search = (char: string) => {
    const now = Date.now();
    const text = now - query.current.at > 700 ? char : query.current.text + char;
    query.current = { text, at: now };
    const from = open ? active : selectedIndex(options, current);
    return typeahead(options, text, from);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const typing = Date.now() - query.current.at < 700 && query.current.text.length > 0;
    const intent = keyIntent(event, open, typing);
    if (!intent) return;
    if (!(intent.type === "commit" && intent.keepDefault)) event.preventDefault();
    if (intent.type === "close") event.stopPropagation();
    if (intent.type === "open") show(intent.to);
    if (intent.type === "close") close();
    if (intent.type === "commit") commit(active, !intent.keepDefault);
    if (intent.type === "move") setActive((index) => moveIndex(options, index, intent.by));
    if (intent.type === "edge") setActive(edgeIndex(options, intent.to));
    if (intent.type === "type") {
      const found = search(intent.char);
      if (open) setActive(found);
      else show(found);
    }
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || list.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <span className={cx("sel", size === "sm" && "sm", disabled && "is-disabled", open && "is-open", className)}>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className={cx("in sel-trigger", size === "sm" && "sm")}
        onClick={(event) => {
          event.preventDefault();
          if (open) close();
          else show("selected");
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => event.key === " " && event.preventDefault()}
      >
        {chosen?.icon && <span className="sel-icon-slot" aria-hidden>{chosen.icon}</span>}
        <span className={cx("sel-value", !chosen && "is-empty")}>{chosen?.label ?? placeholder ?? ""}</span>
        {chosen?.meta && <span className="sel-meta">{chosen.meta}</span>}
        <ChevronDown size={16} className="sel-icon" aria-hidden />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : ariaLabelledBy}
            tabIndex={-1}
            className={cx("sel-pop", placement?.side === "above" && "is-above", size === "sm" && "sm")}
            style={placement ? { top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight } : { visibility: "hidden", top: 0, left: 0 }}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === current}
                aria-disabled={option.disabled || undefined}
                className={cx("sel-opt", index === active && "is-active")}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => !option.disabled && index !== active && setActive(index)}
                onClick={() => !option.disabled && commit(index)}
              >
                {option.icon && <span className="sel-icon-slot" aria-hidden>{option.icon}</span>}
                <span className="sel-opt-text">
                  <span className="sel-opt-label">
                    {option.label}
                    {option.meta && <span className="sel-opt-meta">{option.meta}</span>}
                  </span>
                  {option.description && <span className="sel-opt-desc">{option.description}</span>}
                </span>
                <Check size={15} className="sel-opt-check" aria-hidden />
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </span>
  );
}
