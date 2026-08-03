// Convex functions (server code) reach through the @pantry/convex/api type
// chain and reference process.env. Declare ONLY that minimal global so the api
// types resolve — pulling in @types/node would hand this package a platform
// (Buffer, fs, __dirname, ...) it must not assume it has. Mirrors
// apps/web/src/convex-env.d.ts, which exists for the same reason.
declare const process: { env: Record<string, string | undefined> };
