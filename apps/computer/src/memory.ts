import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import type { Recipe } from "@understudy/protocol";

export const DEFAULT_PROFILE = `# Profile

Who I am, who my owner is, what my role is and the rules I follow. My owner and I keep this short.
`;

export type Memory = {
  root: string;
  runDir: (runId: string) => string;
  profile: () => string;
  lastJournalLines: (count?: number) => string[];
  appendJournal: (line: string, day?: string) => void;
  saveRecipe: (recipe: Recipe) => string;
  briefing: (parts: { recipe?: Recipe; input?: string }) => string;
};

export const RUN_RETENTION_DAYS = 30;

export function pruneRuns(runsRoot: string, now: number = Date.now(), maxAgeDays: number = RUN_RETENTION_DAYS): string[] {
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  let entries;
  try {
    entries = readdirSync(runsRoot, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    const full = join(runsRoot, entry.name);
    try {
      if (statSync(full).mtimeMs >= cutoff) continue;
      rmSync(full, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {}
  }
  return removed;
}

export function dayOf(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function slug(text: string): string {
  const base = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "task";
}

export function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "_";
}

export function recipeMarkdown(recipe: Recipe): string {
  const steps = recipe.steps
    .map((step, index) => `${index + 1}. ${step.mode === "ask" ? "[ask] " : ""}${step.text}${step.detail ? `\n   - how: ${step.detail}` : ""}`)
    .join("\n");
  const questions = recipe.questions.length
    ? `\n\n## Open questions\n\n${recipe.questions.map((question) => `- ${question.text} (${question.options.join(" / ")})${question.answer ? ` -> ${question.answer}` : ""}`).join("\n")}`
    : "";
  return `# ${recipe.title}\n\nWhen: ${recipe.trigger}\n\n## Steps\n\n${steps}${questions}\n`;
}

export type Skill = { name: string; summary: string };

export function listSkills(skillsDir: string, parent: string): Skill[] {
  try {
    if (lstatSync(skillsDir).isSymbolicLink() || !realpathSync(skillsDir).startsWith(realpathSync(parent) + sep)) return [];
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50)
      .map((entry) => {
        const readme = join(skillsDir, entry.name, "README.md");
        let summary = "";
        try {
          if (lstatSync(readme).isFile()) {
            const lines = readFileSync(readme, "utf8").slice(0, 4000).split("\n").map((line) => line.trim()).filter(Boolean);
            summary = (lines.find((line) => !line.startsWith("#")) ?? lines[0] ?? "").replace(/^#+\s*/, "").slice(0, 200);
          }
        } catch {}
        return { name: entry.name.slice(0, 60), summary };
      });
  } catch {
    return [];
  }
}

export function createMemory(home: string): Memory {
  const root = join(home, "memory");
  const runsRoot = join(home, "runs");
  for (const dir of [root, join(root, "recipes"), join(root, "journal"), join(root, "notes"), runsRoot]) mkdirSync(dir, { recursive: true });
  const profileFile = join(root, "profile.md");
  if (!existsSync(profileFile)) writeFileSync(profileFile, DEFAULT_PROFILE);

  const profile = () => {
    try {
      return readFileSync(profileFile, "utf8").trim().slice(0, 6000);
    } catch {
      return "";
    }
  };

  const lastJournalLines = (count = 7) => {
    const dir = join(root, "journal");
    const files = readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort().reverse();
    const collected: string[] = [];
    for (const file of files) {
      const lines = readFileSync(join(dir, file), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => `${file.slice(0, 10)} ${line.slice(2)}`);
      collected.unshift(...lines);
      if (collected.length >= count) break;
    }
    return collected.slice(-count);
  };

  return {
    root,
    runDir(runId) {
      const dir = join(runsRoot, safeSegment(runId));
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    profile,
    lastJournalLines,
    appendJournal(line, day = dayOf()) {
      const clean = line.replace(/\s+/g, " ").trim().slice(0, 500);
      if (clean) appendFileSync(join(root, "journal", `${day}.md`), `- ${clean}\n`);
    },
    saveRecipe(recipe) {
      const file = join(root, "recipes", `${slug(recipe.title)}.md`);
      writeFileSync(file, recipeMarkdown(recipe));
      return file;
    },
    briefing({ recipe, input }) {
      const journal = lastJournalLines(7);
      const skills = listSkills(join(home, "files", "skills"), join(home, "files"));
      return [
        `## Your profile (~/memory/profile.md)\n\n${profile()}`,
        skills.length
          ? `## Your saved skills (~/files/skills/<name>/README.md; read the README before using one)\n\n${skills.map((skill) => `- ${JSON.stringify(skill.name)}: ${JSON.stringify(skill.summary)}`).join("\n")}`
          : "",
        recipe ? `## The task you are running (~/memory/recipes/${slug(recipe.title)}.md)\n\n${recipeMarkdown(recipe)}` : "",
        `## Your last journal lines (~/memory/journal/)\n\n${journal.length ? journal.map((line) => `- ${line}`).join("\n") : "(empty)"}`,
        input ? `## Now\n\n${input}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  };
}
