import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? "http://127.0.0.1:3210";
const convex = new ConvexReactClient(convexUrl as string);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexAuthProvider client={convex}>
      <RouterProvider router={router} />
    </ConvexAuthProvider>
  </React.StrictMode>,
);
