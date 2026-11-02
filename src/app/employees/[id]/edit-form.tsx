"use client";

import { updateEmployee } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { input, label } from "@/components/ui";
import { CAREER_TRACKS, CAREER_TRACK_LABEL, FIELDS, OFFBOARDING_REASONS, OFFBOARDING_REASON_LABEL, STATUSES, STATUS_LABEL } from "@/lib/fields";
import type { Employee } from "@/db/schema";

const HIDDEN = ["leapsomeId", "timebaseId", "countryCode"];

export function EditEmployee({ employee, legalEntityOptions = [] }: { employee: Employee; legalEntityOptions?: string[] }) {
  return (
    <ActionForm action={updateEmployee}>
      <input type="hidden" name="id" value={employee.id} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.filter((f) => !HIDDEN.includes(f.key)).map((f) => {
          const raw = employee[f.key] as string | boolean | null;
          const v = typeof raw === "boolean" ? raw : (raw ?? "");
          const locked = employee.lockedFields.includes(f.key);
          return (
            <div key={f.key}>
              <label className={label}>{f.label} {locked && <span title="Locked — sync won't overwrite">🔒</span>}</label>
              {f.type === "status" ? (
                <select name={f.key} defaultValue={v as string} className={input}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              ) : f.type === "careerTrack" ? (
                <select name={f.key} defaultValue={v as string} className={input}>
                  <option value="">—</option>
                  {CAREER_TRACKS.map((t) => <option key={t} value={t}>{CAREER_TRACK_LABEL[t]}</option>)}
                </select>
              ) : f.type === "offboardingReasonCategory" ? (
                <select name={f.key} defaultValue={v as string} className={input}>
                  <option value="">—</option>
                  {OFFBOARDING_REASONS.map((r) => <option key={r} value={r}>{OFFBOARDING_REASON_LABEL[r]}</option>)}
                </select>
              ) : f.type === "boolean" ? (
                <div className="flex h-9 items-center gap-2">
                  <input name={f.key} type="checkbox" value="true" defaultChecked={Boolean(v)} className="h-4 w-4 rounded border-line" />
                  <input type="hidden" name={f.key} value="false" />
                  <span className="text-sm text-muted">{v ? "Yes" : "No"}</span>
                </div>
              ) : f.key === "legalEntity" ? (
                <>
                  <input name={f.key} type="text" list="legal-entity-options" defaultValue={v as string} className={input} />
                  <datalist id="legal-entity-options">
                    {legalEntityOptions.map((o) => <option key={o} value={o} />)}
                  </datalist>
                </>
              ) : (
                <input name={f.key} type={f.type === "date" ? "date" : f.key === "email" ? "email" : "text"} defaultValue={v as string} required={f.key === "fullName"} className={input} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <SubmitButton pending="Saving…">Save changes</SubmitButton>
      </div>
    </ActionForm>
  );
}
