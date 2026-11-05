import type { RequestStage } from "@/db/schema";
import { STAGE_META, STAGE_PATH } from "@/lib/onboarding/stages";

export function StageBadge({ stage }: { stage: RequestStage }) {
  const m = STAGE_META[stage];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.tone}`}>{m.label}</span>;
}

/** Horizontal progress through the main path; needs_info shows on the "Collecting info" step. */
export function StageProgress({ stage }: { stage: RequestStage }) {
  if (stage === "cancelled") return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">This request was cancelled.</p>;
  const pos = STAGE_PATH.indexOf(stage === "needs_info" ? "collecting" : stage);
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label="Progress">
      {STAGE_PATH.map((s, i) => {
        const done = i < pos;
        const current = i === pos;
        const label = current && stage === "needs_info" ? "Needs info" : STAGE_META[s].label;
        return (
          <li key={s} className="min-w-0" aria-current={current ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${done ? "bg-accent" : current ? (stage === "needs_info" ? "bg-amber-500" : "bg-accent/60") : "bg-line"}`} />
            <div className={`mt-1.5 truncate text-[11px] ${current ? "font-semibold text-ink" : done ? "text-ink" : "text-muted"}`} title={label}>
              {label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
