"use client";

import { useState, useTransition } from "react";
import { deleteAllEmployees } from "@/app/actions";
import { btn } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function DeleteAllButton({ qs, count, filtered }: { qs: string; count: number; filtered: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const label = filtered ? `Delete these ${count.toLocaleString()}` : `Delete all ${count.toLocaleString()}`;
  const phrase = filtered ? `delete these ${count} employees` : `delete all ${count} employees`;

  return (
    <>
      <button disabled={pending || count === 0} className={btn.danger} onClick={() => setOpen(true)}>
        🗑 {label}
      </button>
      <ConfirmDialog
        open={open}
        title={`${label}?`}
        description={
          <>
            This permanently deletes {count.toLocaleString()} employee record(s)
            {filtered ? " matching the current filters" : ""}, along with their change history and any
            survey/probation data. This cannot be undone.
          </>
        }
        confirmLabel={label}
        requirePhrase={phrase}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          startTransition(async () => {
            await deleteAllEmployees(qs);
            setOpen(false);
          });
        }}
      />
    </>
  );
}
