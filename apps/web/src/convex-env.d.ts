// Convex functions (server code) reach through the @pantry/convex/api type
// chain and reference process.env. Declare ONLY that minimal global so the api
// types resolve, without pulling all of @types/node (Buffer, __dirname, fs,
// ...) into the browser app's scope.
declare const process: { env: Record<string, string | undefined> };
