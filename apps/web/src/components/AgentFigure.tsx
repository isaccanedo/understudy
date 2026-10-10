"use client";

import { useEffect, useId, useMemo, useRef, type CSSProperties } from "react";
import { accessory, accessoryTransform, bodyTransform, eyeTransform, parts, REST, shadowTransform } from "@understudy/characters";
import type { AgentState } from "@understudy/protocol";
import { cleanLook, DEFAULT_LOOK, type Look } from "@/lib/look";
import { join, reducedMotion, type Actor, type Pose } from "./figure-motion";

const FACE_FOR_STATE: Partial<Record<AgentState, string>> = {
  working: "attentive",
  thinking: "curious",
  listening: "attentive",
  waiting_you: "excited",
  stuck: "confused",
  done: "happy",
};

const BLUSH = "#FF7A93";

export function AgentFigure({
  state = "calm",
  size = 84,
  look = DEFAULT_LOOK,
  count,
  live = true,
  className = "",
}: {
  state?: AgentState;
  size?: number;
  look?: Partial<Look> | null;
  count?: number;
  live?: boolean;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clean = cleanLook(look);
  const spec = { shape: clean.body, color: clean.color, face: live ? (FACE_FOR_STATE[state] ?? clean.eyes) : clean.eyes, acc: clean.acc, accColor: clean.accColor };
  const { shape, look: face, marks, tones, viewBox } = useMemo(() => parts(spec), [spec.shape, spec.color, spec.face]);
  const extra = useMemo(() => accessory(spec, `${id}a`), [id, spec.shape, spec.color, spec.acc, spec.accColor]);
  const rest: Pose = { ...REST, ...(face.look ? { gx: face.look[0], gy: face.look[1] } : {}) };

  const root = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const markRefs = useRef<(SVGPathElement | null)[]>([]);
  const backRef = useRef<SVGGElement>(null);
  const frontRef = useRef<SVGGElement>(null);
  const actorRef = useRef<Actor | null>(null);

  useEffect(() => {
    if (!live || reducedMotion()) return;
    const actor: Actor = {
      state,
      rest: [rest.gx, rest.gy],
      seed: Math.random(),
      poke: null,
      element: () => root.current,
      apply: (pose) => {
        bodyRef.current?.setAttribute("transform", bodyTransform(spec, pose));
        shadowRef.current?.setAttribute("transform", shadowTransform(spec, pose));
        marks.forEach((mark, i) => markRefs.current[i]?.setAttribute("transform", eyeTransform(spec, mark, mark.side, pose)));
        if (extra) {
          const sway = accessoryTransform(spec, pose);
          backRef.current?.setAttribute("transform", sway);
          frontRef.current?.setAttribute("transform", sway);
        }
      },
    };
    actorRef.current = actor;
    const leave = join(actor);
    return () => {
      actorRef.current = null;
      leave();
    };
  }, [live, state, spec.shape, spec.face, spec.acc, marks, extra]);

  const nudge = (kind: "squish" | "hop") => {
    const actor = actorRef.current;
    if (actor && !actor.poke) actor.poke = { at: performance.now() / 1000, kind };
  };

  const [fx, fy, scale] = shape.face;
  const classes = ["figure", live ? `is-${state}` : "is-still", className].filter(Boolean).join(" ");
  return (
    <div
      ref={root}
      className={classes}
      style={{ "--s": `${size}px` } as CSSProperties}
      aria-hidden
      onPointerEnter={live ? () => nudge("squish") : undefined}
      onPointerDown={live ? () => nudge("hop") : undefined}
    >
      <svg viewBox={viewBox} xmlns="http://www.w3.org/2000/svg" className="figure-art">
        {extra && <defs dangerouslySetInnerHTML={{ __html: extra.defs }} />}
        <defs>
          <radialGradient id={`${id}-fill`} gradientUnits="userSpaceOnUse" cx="-42" cy="-58" r="236">
            <stop offset="0" stopColor={tones.light} />
            <stop offset=".3" stopColor={tones.mid} />
            <stop offset=".68" stopColor={tones.base} />
            <stop offset="1" stopColor={tones.dark} />
          </radialGradient>
          <radialGradient id={`${id}-shadow`}>
            <stop offset="0" stopColor="#000" stopOpacity=".38" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="-160" y="-160" width="320" height="320">
            <path d={shape.d} fill="#fff" />
            {marks.map((mark, i) => (
              <path
                key={`${spec.face}-${i}`}
                ref={(node) => {
                  markRefs.current[i] = node;
                }}
                d={mark.d}
                transform={eyeTransform(spec, mark, mark.side, rest)}
                {...(mark.stroke
                  ? { fill: "none", stroke: "#000", strokeWidth: mark.stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
                  : { fill: "#000" })}
              />
            ))}
          </mask>
        </defs>
        <ellipse ref={shadowRef} rx={shape.width * 0.42} ry="9" fill={`url(#${id}-shadow)`} transform={shadowTransform(spec, rest)} />
        <g ref={bodyRef} transform={bodyTransform(spec, rest)}>
          {extra?.back && <g ref={backRef} transform={accessoryTransform(spec, rest)} dangerouslySetInnerHTML={{ __html: extra.back }} />}
          <path d={shape.d} fill="#0E0F12" />
          <g mask={`url(#${id}-mask)`}>
            <rect x="-160" y="-160" width="320" height="320" fill={`url(#${id}-fill)`} />
          </g>
          {face.blush && (
            <>
              <ellipse cx={fx - 44 * scale} cy={fy + 24 * scale} rx="13" ry="8" fill={BLUSH} opacity=".55" />
              <ellipse cx={fx + 44 * scale} cy={fy + 24 * scale} rx="13" ry="8" fill={BLUSH} opacity=".55" />
            </>
          )}
          {extra && <g ref={frontRef} transform={accessoryTransform(spec, rest)} dangerouslySetInnerHTML={{ __html: extra.front }} />}
        </g>
      </svg>
      {live && state === "waiting_you" && count ? <span className="figure-badge">{count}</span> : null}
    </div>
  );
}
