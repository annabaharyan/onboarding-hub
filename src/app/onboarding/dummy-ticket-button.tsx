"use client";

import { useFormStatus } from "react-dom";

export function DummyTicketButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      {pending ? "Creating ticket…" : "Create dummy ticket"}
    </button>
  );
}
