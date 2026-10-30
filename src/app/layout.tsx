import type { Metadata } from "next";
import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Onboarding Hub", template: "%s · Onboarding Hub" },
  description: "Headcount, onboarding and HR system data in one place.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const authOn = Boolean(process.env.APP_PASSWORD);
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar px-4 py-5 lg:flex print:hidden">
            <div className="mb-8 flex items-center gap-2 px-2">
              <div className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">OH</div>
              <div>
                <div className="text-sm font-semibold text-white">Onboarding Hub</div>
                <div className="text-xs text-slate-400">HR Operations</div>
              </div>
            </div>
            <Suspense fallback={null}><Nav /></Suspense>
            <div className="mt-auto space-y-2 px-2 text-xs text-slate-400">
              {!authOn && <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-300">Auth disabled — set APP_PASSWORD before deploying.</p>}
              {authOn && (
                <form action={logout}>
                  <button className="hover:text-white">Sign out</button>
                </form>
              )}
            </div>
          </aside>
          <div className="min-w-0 flex-1">
            <div className="border-b border-line bg-surface px-4 py-3 lg:hidden">
              <details>
                <summary className="cursor-pointer text-sm font-semibold">☰ Onboarding Hub</summary>
                <div className="mt-3 rounded-lg bg-sidebar p-2">
                  <Suspense fallback={null}><Nav /></Suspense>
                </div>
              </details>
            </div>
            <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
