package nutrition

import (
	"context"
	"sync"
)

// Provider resolves a canonical ingredient key to a food. A miss is `false`, not
// an error: an ingredient we have no data for is an ordinary, expected outcome
// that the coverage report exists to describe.
type Provider interface {
	Lookup(ctx context.Context, canonicalItem string) (Food, bool, error)
}

// StaticProvider serves foods from an in-memory map. It backs the checked-in
// snapshot and the entire unit suite, so neither tests nor offline development
// need an api.data.gov key.
type StaticProvider struct{ foods map[string]Food }

func NewStaticProvider(foods map[string]Food) *StaticProvider {
	return &StaticProvider{foods: foods}
}

func (p *StaticProvider) Lookup(_ context.Context, canonicalItem string) (Food, bool, error) {
	f, ok := p.foods[canonicalItem]
	return f, ok, nil
}

// NullProvider matches nothing. It is what the service runs on when no FDC key
// is configured: every line unresolved, coverage 0, and the UI says nutrition is
// unavailable — never an error, and never a partial number shown as complete.
type NullProvider struct{}

func (NullProvider) Lookup(context.Context, string) (Food, bool, error) { return Food{}, false, nil }

// ChainProvider tries each provider in order and takes the first match.
type ChainProvider []Provider

func (c ChainProvider) Lookup(ctx context.Context, canonicalItem string) (Food, bool, error) {
	var firstErr error
	for _, p := range c {
		f, ok, err := p.Lookup(ctx, canonicalItem)
		if err != nil {
			// Keep going: a failing FDC call must not mask a usable snapshot hit.
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if ok {
			return f, true, nil
		}
	}
	return Food{}, false, firstErr
}

// NewProvider composes the standard provider stack: a read-through cache over
// live FDC, with the checked-in snapshot underneath.
//
// The ordering matters. FDC comes first so a configured key yields real data
// that the cache then keeps; the snapshot sits underneath so that with no key,
// a rate limit, or no network, common ingredients still resolve. apiKey may be
// empty — that costs coverage, not correctness.
func NewProvider(cache Cache, apiKey string) *CachingProvider {
	sources := ChainProvider{}
	if fdc := NewFDCProvider(apiKey); fdc != nil {
		sources = append(sources, fdc)
	}
	sources = append(sources, SnapshotProvider())
	return NewCachingProvider(cache, sources)
}

// Cache is the persistent side of the mapping table. It is the cache *and* the
// override point: one row per canonical ingredient, so a wrong fuzzy match is
// corrected by editing a row rather than by tuning a matcher.
type Cache interface {
	Food(ctx context.Context, canonicalItem string) (Food, bool, error)
	PutFood(ctx context.Context, canonicalItem string, food Food) error
}

// CachingProvider reads through a Cache to a source. FDC data is CC0, so the
// cache is permanent and steady-state traffic to the API approaches zero.
type CachingProvider struct {
	cache  Cache
	source Provider

	// misses is a process-lifetime negative cache. Without it, an ingredient FDC
	// has nothing for is re-searched on every single page view.
	mu     sync.Mutex
	misses map[string]bool
}

func NewCachingProvider(cache Cache, source Provider) *CachingProvider {
	return &CachingProvider{cache: cache, source: source, misses: map[string]bool{}}
}

func (p *CachingProvider) Lookup(ctx context.Context, canonicalItem string) (Food, bool, error) {
	if f, ok, err := p.cache.Food(ctx, canonicalItem); err != nil {
		return Food{}, false, err
	} else if ok {
		return f, true, nil
	}
	p.mu.Lock()
	missed := p.misses[canonicalItem]
	p.mu.Unlock()
	if missed {
		return Food{}, false, nil
	}

	f, ok, err := p.source.Lookup(ctx, canonicalItem)
	if err != nil {
		return Food{}, false, err
	}
	if !ok {
		p.mu.Lock()
		p.misses[canonicalItem] = true
		p.mu.Unlock()
		return Food{}, false, nil
	}
	if err := p.cache.PutFood(ctx, canonicalItem, f); err != nil {
		// The lookup succeeded; failing to memoise it is not worth failing on.
		return f, true, nil
	}
	return f, true, nil
}

// Refresh re-runs the source lookup for one ingredient and overwrites the cached
// mapping, bypassing both caches. It is the path by which snapshot-seeded rows
// are upgraded to live FDC data once a key is configured. A row a human has
// marked `reviewed` is left alone — that flag exists to pin a correction, and a
// refresh that silently undid it would make the override point useless.
func (p *CachingProvider) Refresh(ctx context.Context, canonicalItem string) (Food, bool, error) {
	if existing, ok, err := p.cache.Food(ctx, canonicalItem); err != nil {
		return Food{}, false, err
	} else if ok && existing.Reviewed {
		return existing, true, nil
	}

	f, ok, err := p.source.Lookup(ctx, canonicalItem)
	if err != nil || !ok {
		return Food{}, false, err
	}
	p.mu.Lock()
	delete(p.misses, canonicalItem)
	p.mu.Unlock()
	if err := p.cache.PutFood(ctx, canonicalItem, f); err != nil {
		return Food{}, false, err
	}
	return f, true, nil
}

// MemoryCache is the in-process Cache used by tests and by a service running
// without Postgres.
type MemoryCache struct {
	mu    sync.Mutex
	foods map[string]Food
}

func NewMemoryCache() *MemoryCache { return &MemoryCache{foods: map[string]Food{}} }

func (c *MemoryCache) Food(_ context.Context, canonicalItem string) (Food, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f, ok := c.foods[canonicalItem]
	return f, ok, nil
}

func (c *MemoryCache) PutFood(_ context.Context, canonicalItem string, food Food) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.foods[canonicalItem]; ok && existing.Reviewed {
		return nil
	}
	c.foods[canonicalItem] = food
	return nil
}
