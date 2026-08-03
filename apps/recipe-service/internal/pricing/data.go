// Package pricing turns an aggregated grocery list into an estimated cost using
// free US Bureau of Labor Statistics Average Price data.
//
// The estimate is deliberately modest: a national monthly average for a generic
// item is not what any particular store charges. The package's contract is
// therefore to be honest rather than complete — it reports what it priced, what
// it could not, and how old the underlying data is, and it never guesses a
// number for an ingredient it cannot map.
//
// It imports nothing from internal/recipe. Its input is the normalized
// ingredient identity that package already emits, passed as plain values, so
// pricing can become its own service by moving this directory.
package pricing

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"
)

//go:embed bls_snapshot.json
var snapshotJSON []byte

//go:embed pricing_map.json
var mappingJSON []byte

// LoadSnapshot parses a snapshot document.
func LoadSnapshot(raw []byte) (Snapshot, error) {
	var s Snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return Snapshot{}, fmt.Errorf("parse bls_snapshot.json: %w", err)
	}
	return s, nil
}

// LoadMapping parses a mapping document.
func LoadMapping(raw []byte) (MappingFile, error) {
	var m MappingFile
	if err := json.Unmarshal(raw, &m); err != nil {
		return MappingFile{}, fmt.Errorf("parse pricing_map.json: %w", err)
	}
	return m, nil
}

// EmbeddedMapping returns the compiled-in mapping. cmd/pricing-refresh uses it
// to learn which BLS series to fetch, so the mapping is the single source of
// truth for which series the snapshot contains.
func EmbeddedMapping() (MappingFile, error) { return LoadMapping(mappingJSON) }

var (
	defaultOnce sync.Once
	defaultEst  *Estimator
	defaultErr  error
)

// Default returns the process-wide estimator built from the embedded data. A
// malformed snapshot or mapping fails here rather than producing wrong money.
func Default() (*Estimator, error) {
	defaultOnce.Do(func() {
		snap, err := LoadSnapshot(snapshotJSON)
		if err != nil {
			defaultErr = err
			return
		}
		m, err := LoadMapping(mappingJSON)
		if err != nil {
			defaultErr = err
			return
		}
		defaultEst, defaultErr = NewEstimator(snap, m)
	})
	return defaultEst, defaultErr
}
