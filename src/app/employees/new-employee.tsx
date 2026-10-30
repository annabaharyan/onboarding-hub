"use client";

import { useRef } from "react";
import { createEmployee } from "../actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { btn, input, label } from "@/components/ui";
import { STATUSES, STATUS_LABEL } from "@/lib/fields";

export function NewEmployee() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className={btn.primary} onClick={() => ref.current?.showModal()}>+ Add employee</button>
      <dialog ref={ref} className="m-auto w-full max-w-md rounded-xl border border-line p-0 backdrop:bg-ink/40">
        <ActionForm action={createEmployee} className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">Add employee</h2>
          <p className="text-sm text-muted">For people not yet in Leapsome or Jira. Use Import for bulk changes.</p>
          <div><label className={label}>Full name *</label><input name="fullName" required className={input} /></div>
          <div><label className={label}>Work email</label><input name="email" type="email" className={input} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Business unit</label><input name="businessUnit" className={input} /></div>
            <div><label className={label}>Start date</label><input name="startDate" type="date" className={input} /></div>
          </div>
          <div>
            <label className={label}>Status</label>
            <select name="status" defaultValue="pre_onboarding" className={input}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => ref.current?.close()}>Cancel</button>
            <SubmitButton pending="Creating…">Create</SubmitButton>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}
