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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { run, error, pending } = useAsyncAction();

  // Convex Auth takes the credentials as a plain object just as happily as a
  // FormData — and a plain object survives a port to a platform with no
  // `<form>` element to read.
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await run(() => signIn("password", { email, password, flow }));
  }

  return (
    <Card title={flow === "signIn" ? "Sign in" : "Create account"}>
      <form data-testid="auth-form" onSubmit={submit} className="flex flex-col gap-3">
        <Input
          name="email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
