"use client";

import { useActionState } from "react";
import { login } from "../actions";
import { ActionMessage, SubmitButton } from "@/components/forms";
import { input, label } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(login, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className={label} htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoFocus className={input} />
      </div>
      <SubmitButton className="w-full" pending="Signing in…">Sign in</SubmitButton>
      <ActionMessage state={state} />
    </form>
  );
}
