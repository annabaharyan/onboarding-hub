"use client";

import { useEffect, useState, type ReactNode } from "react";
import { btn } from "./ui";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  requirePhrase,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** If set, the confirm button stays disabled until the user types this phrase exactly. */
  requirePhrase?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const canConfirm = !requirePhrase || typed === requirePhrase;

  function handleCancel() {
    setTyped("");
    onCancel();
  }
  function handleConfirm() {
    setTyped("");
    onConfirm();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleCancel}>
      <div role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <div className="mt-2 text-sm text-muted">{description}</div>
        {requirePhrase && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-muted">
              Type &ldquo;{requirePhrase}&rdquo; to confirm
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={handleCancel} className={btn.secondary} disabled={pending}>
            {cancelLabel}
          </button>
          <button onClick={handleConfirm} className={btn.danger} disabled={pending || !canConfirm}>
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
