import { desc, eq } from "drizzle-orm";
import { TemplateCard } from "@/components/templates/TemplateCard";
import { getDb, schema } from "@/lib/db";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { templatePlaceholders } from "@/lib/templates";
import { EmptyState } from "@/components/ui/EmptyState";

const t = messages.templates;

export default async function TemplatesPage() {
  const user = await requireUser();
  const db = getDb();
  const rows = await db
    .select({ template: schema.templates, author: schema.user.name })
    .from(schema.templates)
    .leftJoin(schema.user, eq(schema.user.id, schema.templates.createdBy))
    .orderBy(desc(schema.templates.uses), desc(schema.templates.createdAt))
    .limit(200);
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.ownerId, user.id));
  return (
    <div className="page narrow">
      <div className="top">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 py-6">
        {rows.length === 0 && (
          <EmptyState framed mood="waiting" title={messages.empty.templatesTitle} body={messages.empty.templatesBody} action={{ href: "/recipes", label: messages.empty.templatesAction, secondary: true }} />
        )}
        {rows.map(({ template, author }) => (
          <TemplateCard
            key={template.id}
            template={{
              id: template.id,
              title: template.title,
              description: template.description,
              steps: template.recipe.steps.map((s) => ({ text: s.text, ask: s.mode === "ask" })),
              placeholders: templatePlaceholders(template.recipe),
              scheduled: Boolean(template.cron),
              uses: template.uses,
              author: author ?? "",
            }}
            agents={agents}
            canDelete={template.createdBy === user.id || user.admin}
          />
        ))}
      </div>
    </div>
  );
}
