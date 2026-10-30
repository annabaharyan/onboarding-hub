"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/employees", label: "Employees", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0" },
  { href: "/onboarding", label: "Onboarding requests", icon: "M9 5h6M9 3h6v4H9zM5 7h14v14H5zM9 13l2 2 4-4" },
  { href: "/import", label: "Import Excel", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" },
  { href: "/export", label: "Export Excel", icon: "M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" },
  { href: "/integrations", label: "Integrations & sync", icon: "M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
          >
            <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={i.icon} />
            </svg>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
