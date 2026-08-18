import { useAuthActions } from "@convex-dev/auth/react";
import { useAsyncAction } from "@pantry/core/react";
import { TEST_IDS } from "@pantry/core/testing";
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
      <form data-testid={TEST_IDS.auth.form} onSubmit={submit} className="flex flex-col gap-3">
        {/*
          Password managers only offer to fill (and to save) a credential when
          they can pair an identifier field with a password field. The pairing
          token is `username` — not `email`, which marks a plain contact address
          — and the saved entry is keyed on the stable id/name, so both are
          load-bearing metadata rather than decoration. `new-password` on the
          sign-up flow is what triggers the generate-a-strong-password offer.
        */}
        <Input
          id="email"
          testId={TEST_IDS.auth.email}
          name="email"
          type="email"
          placeholder="Email"
          aria-label="Email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="password"
          testId={TEST_IDS.auth.password}
          name="password"
          type="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" testId={TEST_IDS.auth.submit} disabled={pending}>
          {pending ? "…" : flow === "signIn" ? "Sign in" : "Sign up"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          testId={TEST_IDS.auth.toggleFlow}
          onClick={() => setFlow((f) => (f === "signIn" ? "signUp" : "signIn"))}
        >
          {flow === "signIn" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </Button>
        <ErrorText message={error} testId={TEST_IDS.auth.error} />
      </form>
    </Card>
  );
}
