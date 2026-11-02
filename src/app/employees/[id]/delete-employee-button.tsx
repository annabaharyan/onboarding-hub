"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEmployee } from "@/app/actions";
import { btn } from "@/components/ui";

export function DeleteEmployeeButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      className={btn.danger}
      onClick={() => {
        if (!confirm(`Delete ${name}? This permanently removes their record, change history, and any survey/probation data. This cannot be undone.`)) return;
        startTransition(async () => {
          await deleteEmployee(id);
          router.push("/employees");
        });
      }}
    >
      {pending ? "Deleting…" : "🗑 Delete employee"}
    </button>
  );
}
