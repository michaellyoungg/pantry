/**
 * Native sign-in / sign-up.
 *
 * The web counterpart is `apps/web/src/components/AuthForm.tsx`. The two share
 * the submit logic — `useAsyncAction` from `@pantry/core/react` — and nothing
 * else: no view code crosses between the clients (parity plan, "no view code is
 * shared in either direction").
 *
 * Web's version already passes the credentials as a plain object rather than a
 * `FormData`, precisely so this port had something to copy.
 */
import { useAuthActions } from "@convex-dev/auth/react";
import { useAsyncAction } from "@pantry/core/react";
import { colorTokens } from "@pantry/design-tokens";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { surfaceTestIDs } from "../testing/testIDs";

const id = surfaceTestIDs("auth");

export function AuthForm() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { run, error, pending } = useAsyncAction();

  const submit = () => run(() => signIn("password", { email, password, flow }));

  return (
    <View className="flex-1 justify-center gap-3 bg-bg p-6" testID={id("form")}>
      <Text className="mb-2 text-2xl font-semibold text-text" testID={id("title")}>
        {flow === "signIn" ? "Sign in" : "Create account"}
      </Text>

      {/*
        iOS and Android password managers pair an identifier field with a
        password field, and only offer to fill or save when both are tagged.
        `textContentType` is what iOS reads; `autoComplete` is Android's. These
        are the native equivalents of web's `autocomplete` tokens, and are
        load-bearing rather than decoration.
      */}
      <TextInput
        className="rounded-lg border border-border bg-surface px-3 py-3 text-base text-text"
        placeholder="Email"
        placeholderTextColor={colorTokens.muted}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
        testID={id("email")}
      />
      <TextInput
        className="rounded-lg border border-border bg-surface px-3 py-3 text-base text-text"
        placeholder="Password"
        placeholderTextColor={colorTokens.muted}
        secureTextEntry
        textContentType={flow === "signIn" ? "password" : "newPassword"}
        autoComplete={flow === "signIn" ? "current-password" : "new-password"}
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        testID={id("password")}
      />

      <Pressable
        className="items-center rounded-lg bg-primary px-4 py-3 active:bg-primary-hover"
        disabled={pending}
        onPress={submit}
        testID={id("submit")}
      >
        <Text className="text-base font-semibold text-surface">
          {pending ? "…" : flow === "signIn" ? "Sign in" : "Sign up"}
        </Text>
      </Pressable>

      <Pressable
        className="items-center py-2"
        onPress={() => setFlow((f) => (f === "signIn" ? "signUp" : "signIn"))}
        testID={id("toggle-flow")}
      >
        <Text className="text-sm text-muted">
          {flow === "signIn" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </Text>
      </Pressable>

      {error === null ? null : (
        <Text className="text-sm text-danger" testID={id("error")}>
          {error}
        </Text>
      )}
    </View>
  );
}
