import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-accent text-sm font-bold text-white">OH</div>
          <div>
            <div className="font-semibold">Onboarding Hub</div>
            <div className="text-xs text-muted">HR Operations</div>
          </div>
        </div>
        <Suspense>
          <NextField searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function NextField({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={next ?? "/"} />;
}
