"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEmployee } from "@/app/actions";
import { btn } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function DeleteEmployeeButton({ id, name }: { id: number; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <>
      <button disabled={pending} className={btn.danger} onClick={() => setOpen(true)}>
        🗑 Delete employee
      </button>
      <ConfirmDialog
        open={open}
        title={`Delete ${name}?`}
        description="This permanently removes their record, change history, and any survey/probation data. This cannot be undone."
        confirmLabel="Delete employee"
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          startTransition(async () => {
            await deleteEmployee(id);
            router.push("/employees");
          });
        }}
      />
    </>
  );
}
