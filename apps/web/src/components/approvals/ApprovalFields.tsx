import { Info, TriangleAlert } from "lucide-react";
import { emptyFields, fieldDisplay, isOffRecipe } from "@/lib/approval-fields";
import { messages } from "@/lib/messages";

export function ApprovalFields({ fields, compact = false }: { fields: { label: string; value: string }[]; compact?: boolean }) {
  return (
    <>
      {emptyFields(fields).length > 0 && (
        <div className="flex gap-2 items-start rounded-[10px] bg-graphite px-3 py-2.5 text-[12.5px] text-ash" role="note">
          <Info size={16} className="flex-none mt-px" aria-hidden />
          <span>{messages.approvals.emptyWarning(emptyFields(fields))}</span>
        </div>
      )}
      {isOffRecipe(fields) && (
        <div className="flex gap-2 items-start rounded-[10px] bg-ember/60 px-3 py-2.5 text-[12.5px] text-mist" role="alert">
          <TriangleAlert size={16} className="text-coral flex-none mt-px" aria-hidden />
          <span>{messages.approvals.offRecipe}</span>
        </div>
      )}
      {fields.length > 0 && (
        <dl className={`m-0 grid grid-cols-[minmax(80px,auto)_1fr] gap-x-4 gap-y-1 ${compact ? "text-[12.5px]" : "text-[13px]"}`}>
          {fields.map((f, i) => (
            <div key={i} className="contents">
              <dt className="text-smoke truncate">{f.label}</dt>
              <dd className="m-0 min-w-0">
                {fieldDisplay(f.value) === null ? (
                  <span className="italic text-smoke text-[12px]">{messages.approvals.emptyValue}</span>
                ) : (
                  <pre className={`m-0 whitespace-pre-wrap break-words overflow-auto font-mono text-[12px] ${compact ? "max-h-48" : "max-h-64"}`}>{f.value}</pre>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
