package recipe

import (
	"crypto/rand"
	"encoding/hex"
)

// newID returns a random 128-bit hex identifier. Uses crypto/rand so we add no
// third-party dependency (the plan's pgx-only constraint).
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("recipe: crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}
