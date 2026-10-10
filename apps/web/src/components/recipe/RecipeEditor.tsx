"use client";

import type { Look } from "@/lib/look";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { Recipe } from "@understudy/protocol";
import { runRecipeNow, saveRecipe, setRecipeActive, testRecipe } from "@/app/actions/recipes";
import { AgentFigure } from "@/components/AgentFigure";
import { AskCard } from "@/components/recipe/AskCard";
import { QuestionCards } from "@/components/recipe/QuestionCards";
import { RecentRuns, type RecentRun } from "@/components/recipe/RecentRuns";
import { ShareTemplateCard } from "@/components/recipe/ShareTemplateCard";
import { StepList } from "@/components/recipe/StepList";
import { TriggersCard } from "@/components/recipe/TriggersCard";
import type { WatchState } from "@/components/recipe/WatchCard";
import { Textarea } from "@/components/ui/controls";
import { messages } from "@/lib/messages";
import { templatePlaceholders } from "@/lib/templates";

const t = messages.recipe;

export function RecipeEditor({
  recipeId,
  agentId,
  agentName,
  look,
  initial,
  initialCron,
  initialTimezone,
  initialAskAlways,
  initialActive,
  runsDone,
  runs,
  webhookEnabled,
  email,
  watch,
}: {
  recipeId: string;
  agentId: string;
  agentName: string;
  look: Look;
  initial: Recipe;
  initialCron: string;
  initialTimezone: string;
  initialAskAlways: boolean;
  initialActive: boolean;
  runsDone: number;
  runs: RecentRun[];
  webhookEnabled: boolean;
  email: { domain: string; localPart: string | null; senders: string; ownerDomain: string } | null;
  watch: WatchState;
}) {
  const [recipe, setRecipe] = useState<Recipe>(initial);
  const [cron, setCron] = useState(initialCron);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [askAlways, setAskAlways] = useState(initialAskAlways);
  const [active, setActive] = useState(initialActive);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);

  function update(patch: Partial<Recipe>) {
    setRecipe((r) => ({ ...r, ...patch }));
    setDirty(true);
  }

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  async function persist() {
    const result = await saveRecipe(recipeId, { recipe, cron, timezone, askAlways });
    if (!result.ok) {
      setNotice({ text: result.error ?? messages.common.error, error: true });
      return false;
    }
    setDirty(false);
    return true;
  }

  function onSave() {
    startTransition(async () => {
      if (await persist()) setNotice({ text: t.saved });
    });
  }

  function onTest() {
    startTransition(async () => {
      if (dirty && !(await persist())) return;
      const result = await testRecipe(recipeId);
      setNotice(result.ok ? { text: t.testSent } : { text: t.testOffline, error: true });
    });
  }

  function onRunNow(input: string) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        if (dirty && !(await persist())) return resolve(false);
        const result = await runRecipeNow(recipeId, input);
        setNotice(result.ok ? { text: t.runStarted } : { text: t.testOffline, error: true });
        resolve(result.ok);
      });
    });
  }

  function onToggleActive() {
    startTransition(async () => {
      if (dirty && !(await persist())) return;
      await setRecipeActive(recipeId, !active);
      setActive(!active);
      setNotice(null);
    });
  }

  const openQuestions = recipe.questions.filter((q) => !q.answer);

  return (
    <div className="page rp">
      <header className="rp-head">
        <AgentFigure state={openQuestions.length > 0 ? "thinking" : "done"} size={48} look={look} />
        <div className="min-w-0 flex-1">
          <h1 className="rp-title">{t.title}</h1>
          <p className="rp-sub">{t.subtitle(agentName)}</p>
        </div>
        <div className="rp-status">
          <span className={`pill ${active ? "g" : ""}`}>
            <span className="dot" />
            {active ? t.active : t.paused}
          </span>
          <button className="btn sec sm" disabled={pending} onClick={onToggleActive}>
            {active ? t.deactivate : t.activate}
          </button>
        </div>
      </header>

      <section className="card rp-card" aria-labelledby="rp-steps">
        <h2 id="rp-steps" className="sr-only">
          {t.stepsTitle}
        </h2>
        <textarea
          className="rp-trigger-text"
          rows={1}
          value={recipe.trigger || recipe.title}
          onChange={(e) => update({ trigger: e.target.value })}
          aria-label={t.trigger}
        />
        <StepList steps={recipe.steps} onChange={(steps) => update({ steps })} />
        <p className="rp-hint">
          {t.notRight}{" "}
          <Link href={`/agents/${agentId}/teach`} className="rp-link">
            {t.recordAgain}
          </Link>
        </p>
      </section>

      <QuestionCards questions={recipe.questions} look={look} onChange={(questions) => update({ questions })} />

      <TriggersCard
        recipeId={recipeId}
        cron={cron}
        timezone={timezone}
        onCron={edit(setCron)}
        onTimezone={edit(setTimezone)}
        watch={watch}
        webhookEnabled={webhookEnabled}
        email={email}
      />

      <AskCard
        askFirstRuns={recipe.askFirstRuns}
        runsDone={runsDone}
        askAlways={askAlways}
        onAskFirstRuns={(askFirstRuns) => update({ askFirstRuns })}
        onAskAlways={edit(setAskAlways)}
      />

      <div className="rp-more">
        <RecentRuns agentId={agentId} runs={runs} />
        <ShareTemplateCard
          recipeId={recipeId}
          title={recipe.title}
          placeholders={templatePlaceholders(recipe)}
          beforeShare={async () => !dirty || (await persist())}
        />
      </div>

      <div className="rp-bar">
        {noting && (
          <Textarea
            size="sm"
            autoFocus
            aria-label={t.runNowTitle}
            className="resize-none [field-sizing:content] !min-h-0"
            placeholder={t.runNowPlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        <div className="rp-bar-row">
          <span role="status" className={`rp-bar-note ${notice?.error ? "text-coral" : notice ? "text-green" : ""}`}>
            {notice ? notice.text : dirty ? t.unsaved : null}
          </span>
          {!noting && (
            <button type="button" className="rp-link" onClick={() => setNoting(true)}>
              {t.addNote}
            </button>
          )}
          {dirty && (
            <button className="btn sec sm" disabled={pending} onClick={onSave}>
              {t.save}
            </button>
          )}
          <button className="btn sec sm" disabled={pending} onClick={onTest}>
            {pending ? t.testing : t.test}
          </button>
          <button
            className="btn pri sm"
            disabled={pending}
            onClick={async () => {
              if (await onRunNow(note)) {
                setNote("");
                setNoting(false);
              }
            }}
          >
            {t.runNow}
          </button>
        </div>
      </div>
    </div>
  );
}
