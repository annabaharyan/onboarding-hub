"use client";

import { useTransition } from "react";
import { deleteAllEmployees } from "@/app/actions";
import { btn } from "@/components/ui";

export function DeleteAllButton({ qs, count, filtered }: { qs: string; count: number; filtered: boolean }) {
  const [pending, startTransition] = useTransition();
  const label = filtered ? `Delete these ${count.toLocaleString()}` : `Delete all ${count.toLocaleString()}`;
  return (
    <button
      disabled={pending || count === 0}
      className={btn.danger}
      onClick={() => {
        const phrase = filtered ? `delete these ${count} employees` : `delete all ${count} employees`;
        const typed = prompt(`This permanently deletes ${count.toLocaleString()} employee record(s)${filtered ? " matching the current filters" : ""}, along with their change history and any survey/probation data. This cannot be undone.\n\nType "${phrase}" to confirm:`);
        if (typed !== phrase) return;
        startTransition(async () => {
          await deleteAllEmployees(qs);
        });
      }}
    >
      {pending ? "Deleting…" : `🗑 ${label}`}
    </button>
  );
}
