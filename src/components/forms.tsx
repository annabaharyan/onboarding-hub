"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import { btn } from "./ui";

export function SubmitButton({ children, pending: pendingLabel, variant = "primary", className = "" }: { children: ReactNode; pending?: string; variant?: keyof typeof btn; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${btn[variant]} ${className}`}>
      {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {pending ? pendingLabel ?? "Working…" : children}
    </button>
  );
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role="status" className={`mt-2 rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
      {state.message}
    </p>
  );
}

/** A form bound to a server action that shows the result message inline. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <ActionMessage state={state} />
    </form>
  );
}
