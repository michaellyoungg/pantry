// Package contract holds the conformance tests that pin the Go server structs
// to contract/openapi.yaml, the single source of truth for the recipe-service
// HTTP contract (BL-0007).
//
// The TypeScript side of the contract is GENERATED from that spec
// (packages/types/src/contract.generated.ts). The Go side is CHECKED against it
// instead, and that asymmetry is deliberate rather than a shortcut:
//
//   - The wire structs live in four packages that are kept apart on purpose.
//     internal/recommend imports nothing at all, which is what makes the ranker
//     a pure, table-testable unit; internal/nutrition and internal/pricing
//     likewise refuse a dependency on internal/recipe. Aliasing their types to
//     one generated package would collapse exactly the boundaries those
//     packages document at length.
//   - The structs carry behaviour and provenance a schema cannot: pointer
//     fields whose nil-ness is load-bearing (BL-0035's servings), comments
//     recording why a field is shaped the way it is, and methods.
//
// So the spec generates the client and audits the server. Drift in either
// direction is a build failure: `pnpm contract:check` fails when the generated
// TypeScript is stale, and the tests in this package fail when a Go struct
// stops matching the schema bound to it.
//
// The package has no non-test API. It exists so `go test ./...` walks it.
package contract
