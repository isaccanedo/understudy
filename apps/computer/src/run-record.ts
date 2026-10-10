import { RUN_RECORD_MAX_SCREENSHOTS, type RunStep } from "@understudy/protocol";
import type { BrainEvent } from "./brain.ts";
import { withoutResultLine } from "./recipe.ts";

const MAX_STEPS = 200;

const SCREEN_CHANGING = /browser_(navigate|navigate_back|click|type|fill_form|select_option|press_key|drag|file_upload|handle_dialog|tabs)$/;

export type Screenshot = () => Promise<string | undefined>;

export function approvalIdFrom(text: string): string | undefined {
  return text.match(/request_?id\W{1,8}([A-Za-z0-9_-]{4,})/i)?.[1];
}

export function createRunRecord(options: { describe: (name: string, input: Record<string, unknown>) => string; screenshot?: Screenshot }) {
  const steps: RunStep[] = [];
  const pendingShots: Promise<void>[] = [];
  const openTools: { name: string; index: number }[] = [];
  let shots = 0;
  let skipNextShot = false;

  const push = (step: RunStep) => {
    if (steps.length >= MAX_STEPS) return -1;
    steps.push(step);
    return steps.length - 1;
  };

  const shoot = (index: number, reserveLast: boolean) => {
    if (!options.screenshot || index < 0) return;
    const limit = reserveLast ? RUN_RECORD_MAX_SCREENSHOTS - 1 : RUN_RECORD_MAX_SCREENSHOTS;
    if (shots >= limit) return;
    shots++;
    pendingShots.push(
      options
        .screenshot()
        .then((jpeg) => {
          if (jpeg) steps[index].screenshotJpegBase64 = jpeg;
        })
        .catch(() => {}),
    );
  };

  return {
    observe(event: BrainEvent) {
      const at = Date.now();
      if (event.kind === "text") {
        const text = withoutResultLine(event.text).slice(0, 500);
        if (text) push({ at, text });
        return;
      }
      if (event.kind === "tool") {
        const index = push({ at, text: options.describe(event.name, event.input) });
        openTools.push({ name: event.name, index });
        return;
      }
      if (event.kind === "tool_result") {
        const position = openTools.findIndex((open) => open.name === event.name);
        const open = position >= 0 ? openTools.splice(position, 1)[0] : undefined;
        if (!open || open.index < 0) return;
        const id = approvalIdFrom(event.text);
        if (id) steps[open.index].approvalId = id;
        if (/fill_credential$/.test(event.name)) {
          skipNextShot = true;
          return;
        }
        if (SCREEN_CHANGING.test(event.name) && !event.isError) {
          if (skipNextShot) skipNextShot = false;
          else shoot(open.index, true);
        }
      }
    },
    async finish(): Promise<RunStep[]> {
      if (options.screenshot && shots < RUN_RECORD_MAX_SCREENSHOTS && !skipNextShot) shoot(push({ at: Date.now(), text: "Final screen" }), false);
      await Promise.all(pendingShots);
      return steps;
    },
  };
}
