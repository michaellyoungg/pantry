import { useAuthActions } from "@convex-dev/auth/react";
import { useAsyncAction } from "@pantry/core/react";
import { useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

export function AuthForm() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const { run, error, pending } = useAsyncAction();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("flow", flow);
    await run(() => signIn("password", formData));
  }

  return (
    <Card title={flow === "signIn" ? "Sign in" : "Create account"}>
      <form data-testid="auth-form" onSubmit={submit} className="flex flex-col gap-3">
        <Input name="email" type="email" placeholder="Email" autoComplete="email" required />
        <Input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
          required
        />
        <Button type="submit" disabled={pending}>
          {pending ? "…" : flow === "signIn" ? "Sign in" : "Sign up"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setFlow((f) => (f === "signIn" ? "signUp" : "signIn"))}
        >
          {flow === "signIn" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </Button>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
