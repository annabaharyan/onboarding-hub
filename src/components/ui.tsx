import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, type Status } from "@/lib/fields";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent/40">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const STATUS_STYLE: Record<Status, string> = {
  pre_onboarding: "bg-violet-50 text-violet-700 ring-violet-200",
  onboarding: "bg-sky-50 text-sky-700 ring-sky-200",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  on_leave: "bg-amber-50 text-amber-800 ring-amber-200",
  offboarding: "bg-orange-50 text-orange-700 ring-orange-200",
  offboarded: "bg-slate-100 text-slate-600 ring-slate-200",
  inactive: "bg-slate-100 text-slate-500 ring-slate-200",
};

export function StatusBadge({ status }: { status: string }) {
  const s = status as Status;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[s] ?? STATUS_STYLE.inactive}`}>{STATUS_LABEL[s] ?? status}</span>;
}

const TONE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  gray: "bg-slate-100 text-slate-600 ring-slate-200",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}>{children}</span>;
}

export function SyncBadge({ status }: { status?: string }) {
  if (!status) return <Badge>Never run</Badge>;
  const map: Record<string, [keyof typeof TONE, string]> = {
    success: ["green", "✓ Success"],
    partial: ["amber", "! Partial"],
    failed: ["red", "✕ Failed"],
    running: ["blue", "… Running"],
    skipped: ["gray", "– Skipped"],
  };
  const [tone, label] = map[status] ?? ["gray", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed",
  secondary: "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed",
  ghost: "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-accent hover:bg-accent/5",
};

export const input = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
export const label = "mb-1 block text-xs font-medium text-muted";

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-md bg-canvas" />
      ))}
    </div>
  );
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, day] = s.split("-");
  return `${day}.${m}.${y}`;
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.APP_TIMEZONE || "Asia/Yerevan" });
}

/** Single-series horizontal bars — one hue, labels in ink, per-bar hover via title. */
export function BarList({ items, href }: { items: { label: string; value: number }[]; href?: (label: string) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const row = (
          <div className="group grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm" title={`${i.label}: ${i.value}`}>
            <span className="truncate text-ink">{i.label}</span>
            <span className="h-2.5 rounded-r bg-canvas">
              <span className="block h-full rounded-r-[4px] bg-accent/80 transition-colors group-hover:bg-accent" style={{ width: `${(i.value / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted">{i.value}</span>
          </div>
        );
        return <li key={i.label}>{href ? <Link href={href(i.label)}>{row}</Link> : row}</li>;
      })}
    </ul>
  );
}
