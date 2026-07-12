import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Email + password only. No email verification / reset (BL-0004 scope).
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
