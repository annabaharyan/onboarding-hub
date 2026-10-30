"use client";

import { updateEmployee } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { input, label } from "@/components/ui";
import { FIELDS, STATUSES, STATUS_LABEL } from "@/lib/fields";
import type { Employee } from "@/db/schema";

const HIDDEN = ["leapsomeId", "timebaseId", "countryCode"];

export function EditEmployee({ employee }: { employee: Employee }) {
  return (
    <ActionForm action={updateEmployee}>
      <input type="hidden" name="id" value={employee.id} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.filter((f) => !HIDDEN.includes(f.key)).map((f) => {
          const v = (employee[f.key] as string | null) ?? "";
          const locked = employee.lockedFields.includes(f.key);
          return (
            <div key={f.key}>
              <label className={label}>{f.label} {locked && <span title="Locked — sync won't overwrite">🔒</span>}</label>
              {f.type === "status" ? (
                <select name={f.key} defaultValue={v} className={input}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              ) : (
                <input name={f.key} type={f.type === "date" ? "date" : f.key === "email" ? "email" : "text"} defaultValue={v} required={f.key === "fullName"} className={input} />
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
