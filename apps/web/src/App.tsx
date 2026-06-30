import { api } from "@pantry/convex/api";

export default function App() {
  // Referencing the generated api here proves the cross-package import +
  // types resolve at build time. Panels are added in later tasks.
  void api;
  return (
    <main>
      <h1>Pantry</h1>
      <p>Plan, cook, shop.</p>
    </main>
  );
}
