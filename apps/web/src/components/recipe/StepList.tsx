"use client";

import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { RecipeStep } from "@understudy/protocol";
import { messages } from "@/lib/messages";

const t = messages.recipe;

function newStepId() {
  return `step_${Math.random().toString(36).slice(2, 10)}`;
}

export function StepList({ steps, onChange }: { steps: RecipeStep[]; onChange: (steps: RecipeStep[]) => void }) {
  function updateStep(id: string, patch: Partial<RecipeStep>) {
    onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function moveStep(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <>
      <ol className="rp-steps">
        {steps.map((step, index) => (
          <li key={step.id} className="rp-step">
            <span className="rp-num" aria-hidden>
              {index + 1}
            </span>
            <div className="min-w-0 flex flex-col gap-0.5">
              <textarea
                className={`rp-step-text ${step.mode === "ask" ? "is-ask" : ""}`}
                rows={1}
                value={step.text}
                aria-label={t.stepLabel(index + 1)}
                onChange={(e) => updateStep(step.id, { text: e.target.value })}
              />
              <input
                className="rp-step-detail"
                value={step.detail ?? ""}
                placeholder={t.stepDetail}
                aria-label={t.stepDetailLabel(index + 1)}
                onChange={(e) => updateStep(step.id, { detail: e.target.value })}
              />
            </div>
            <div className="rp-step-side">
              <button
                type="button"
                className={`pill ${step.mode === "ask" ? "c" : ""}`}
                title={t.toggleHint}
                onClick={() => updateStep(step.id, { mode: step.mode === "ask" ? "auto" : "ask" })}
              >
                {step.mode === "ask" ? t.ask : t.auto}
              </button>
              <span className="rp-step-tools">
                <button type="button" className="rp-icon" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label={t.moveUp}>
                  <ChevronUp size={15} aria-hidden />
                </button>
                <button type="button" className="rp-icon" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} aria-label={t.moveDown}>
                  <ChevronDown size={15} aria-hidden />
                </button>
                <button type="button" className="rp-icon is-danger" onClick={() => onChange(steps.filter((s) => s.id !== step.id))} aria-label={`${t.removeStep}: ${index + 1}`}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn sec sm self-start" onClick={() => onChange([...steps, { id: newStepId(), text: "", mode: "auto" }])}>
        {t.addStep}
      </button>
    </>
  );
}
