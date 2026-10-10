"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import type { Recipe } from "@understudy/protocol";
import { AgentFigure } from "@/components/AgentFigure";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";
import { Segmented } from "@/components/ui/Segmented";

const t = messages.recipe;

type Question = Recipe["questions"][number];

function OtherAnswer({ onUse }: { onUse: (value: string) => void }) {
  const [value, setValue] = useState("");
  const use = () => {
    if (value.trim()) onUse(value.trim());
  };
  return (
    <div className="flex gap-2">
      <Input
        size="sm"
        placeholder={t.questionOther}
        aria-label={t.questionOther}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            use();
          }
        }}
      />
      {value.trim() && (
        <button type="button" className="btn sec sm" onClick={use}>
          {t.questionUse}
        </button>
      )}
    </div>
  );
}

export function QuestionCards({ questions, look, onChange }: { questions: Question[]; look: Look; onChange: (questions: Question[]) => void }) {
  const [answeredHere] = useState(() => new Set(questions.filter((q) => !q.answer).map((q) => q.id)));
  const open = questions.filter((q) => !q.answer);
  const answered = questions.filter((q) => q.answer && answeredHere.has(q.id));

  function answer(id: string, value: string | undefined) {
    onChange(questions.map((x) => (x.id === id ? { ...x, answer: value } : x)));
  }

  if (open.length === 0 && answered.length === 0) return null;

  return (
    <section className="card rp-card rp-questions" aria-labelledby="rp-questions">
      <div className="flex items-center gap-2.5">
        <AgentFigure size={28} look={look} live={false} />
        <h2 id="rp-questions" className="rp-h2">
          {open.length > 0 ? t.questionsTitle(open.length) : t.questionsDone}
        </h2>
      </div>
      {open.length > 0 && (
        <ol className="rp-qlist">
          {open.map((q) => (
            <li key={q.id} className="rp-q">
              <p className="m-0 text-[13.5px]">{q.text}</p>
              {q.options.length > 0 && (
                <Segmented variant="chips" label={q.text} options={q.options.map((option) => ({ value: option, label: option }))} value={undefined} onChange={(option) => answer(q.id, option)} />
              )}
              <OtherAnswer onUse={(value) => answer(q.id, value)} />
            </li>
          ))}
        </ol>
      )}
      {answered.length > 0 && (
        <ul className="rp-answered">
          {answered.map((q) => (
            <li key={q.id}>
              <Check size={15} className="text-green flex-none mt-0.5" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-smoke">{q.text}</span> <b className="font-medium">{q.answer}</b>
              </span>
              <button type="button" className="rp-link" onClick={() => answer(q.id, undefined)}>
                {t.questionChange}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
