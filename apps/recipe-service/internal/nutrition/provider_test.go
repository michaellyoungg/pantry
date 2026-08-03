package nutrition

import (
	"context"
	"errors"
	"testing"
)

// countingProvider records how often the source was consulted, which is the
// whole point of the cache.
type countingProvider struct {
	foods map[string]Food
	calls int
	err   error
}

func (p *countingProvider) Lookup(_ context.Context, item string) (Food, bool, error) {
	p.calls++
	if p.err != nil {
		return Food{}, false, p.err
	}
	f, ok := p.foods[item]
	return f, ok, nil
}

func TestStaticProvider(t *testing.T) {
	p := NewStaticProvider(map[string]Food{"flour": testFlour})
	if f, ok, err := p.Lookup(context.Background(), "flour"); err != nil || !ok || f.Description != testFlour.Description {
		t.Errorf("hit: got %v %v %v", f.Description, ok, err)
	}
	if _, ok, err := p.Lookup(context.Background(), "sumac"); err != nil || ok {
		t.Errorf("miss: got ok=%v err=%v, want a clean miss", ok, err)
	}
}

// A miss is an ordinary outcome, never an error — that is what lets a service
// with no FDC key serve a recipe page instead of a 500.
func TestNullProviderMissesCleanly(t *testing.T) {
	if _, ok, err := (NullProvider{}).Lookup(context.Background(), "flour"); ok || err != nil {
		t.Errorf("got ok=%v err=%v, want a clean miss", ok, err)
	}
}

func TestChainProvider(t *testing.T) {
	t.Run("first match wins", func(t *testing.T) {
		first := NewStaticProvider(map[string]Food{"flour": {Description: "first"}})
		second := NewStaticProvider(map[string]Food{"flour": {Description: "second"}})
		f, ok, err := ChainProvider{first, second}.Lookup(context.Background(), "flour")
		if err != nil || !ok || f.Description != "first" {
			t.Errorf("got %q ok=%v err=%v", f.Description, ok, err)
		}
	})

	t.Run("a failing link does not mask a later hit", func(t *testing.T) {
		broken := &countingProvider{err: errors.New("rate limited")}
		snapshot := NewStaticProvider(map[string]Food{"flour": testFlour})
		f, ok, err := ChainProvider{broken, snapshot}.Lookup(context.Background(), "flour")
		if err != nil || !ok || f.Description != testFlour.Description {
			t.Errorf("got %q ok=%v err=%v, want the snapshot hit", f.Description, ok, err)
		}
	})

	t.Run("an error survives when nothing matched", func(t *testing.T) {
		broken := &countingProvider{err: errors.New("boom")}
		_, ok, err := ChainProvider{broken}.Lookup(context.Background(), "flour")
		if ok || err == nil {
			t.Errorf("got ok=%v err=%v, want the error surfaced", ok, err)
		}
	})
}

func TestCachingProvider(t *testing.T) {
	ctx := context.Background()

	t.Run("second lookup does not reach the source", func(t *testing.T) {
		src := &countingProvider{foods: map[string]Food{"flour": testFlour}}
		p := NewCachingProvider(NewMemoryCache(), src)
		for range 3 {
			if _, ok, _ := p.Lookup(ctx, "flour"); !ok {
				t.Fatal("expected a hit")
			}
		}
		if src.calls != 1 {
			t.Errorf("source consulted %d times, want 1", src.calls)
		}
	})

	t.Run("misses are remembered too", func(t *testing.T) {
		src := &countingProvider{foods: map[string]Food{}}
		p := NewCachingProvider(NewMemoryCache(), src)
		for range 3 {
			if _, ok, _ := p.Lookup(ctx, "sumac"); ok {
				t.Fatal("expected a miss")
			}
		}
		if src.calls != 1 {
			t.Errorf("source consulted %d times for a known miss, want 1", src.calls)
		}
	})

	t.Run("a source error is not cached as a miss", func(t *testing.T) {
		src := &countingProvider{err: errors.New("boom")}
		p := NewCachingProvider(NewMemoryCache(), src)
		if _, _, err := p.Lookup(ctx, "flour"); err == nil {
			t.Fatal("want the error surfaced")
		}
		src.err, src.foods = nil, map[string]Food{"flour": testFlour}
		if _, ok, err := p.Lookup(ctx, "flour"); !ok || err != nil {
			t.Errorf("a transient failure poisoned the cache: ok=%v err=%v", ok, err)
		}
	})
}

// Refresh is how a snapshot-seeded row is upgraded to live FDC data once a key
// is configured — and how a human correction survives that upgrade.
func TestCachingProviderRefresh(t *testing.T) {
	ctx := context.Background()

	t.Run("replaces a cached row", func(t *testing.T) {
		cache := NewMemoryCache()
		if err := cache.PutFood(ctx, "flour", Food{Description: "stale", Source: SourceSnapshot}); err != nil {
			t.Fatal(err)
		}
		src := &countingProvider{foods: map[string]Food{"flour": {Description: "fresh", Source: SourceFDC}}}
		p := NewCachingProvider(cache, src)

		if f, ok, err := p.Refresh(ctx, "flour"); err != nil || !ok || f.Description != "fresh" {
			t.Fatalf("got %q ok=%v err=%v", f.Description, ok, err)
		}
		if f, _, _ := p.Lookup(ctx, "flour"); f.Description != "fresh" {
			t.Errorf("cache still serves %q after refresh", f.Description)
		}
	})

	t.Run("leaves a reviewed row alone", func(t *testing.T) {
		cache := NewMemoryCache()
		if err := cache.PutFood(ctx, "flour", Food{Description: "hand-picked", Reviewed: true}); err != nil {
			t.Fatal(err)
		}
		src := &countingProvider{foods: map[string]Food{"flour": {Description: "automatic"}}}
		p := NewCachingProvider(cache, src)

		f, ok, err := p.Refresh(ctx, "flour")
		if err != nil || !ok || f.Description != "hand-picked" {
			t.Fatalf("got %q ok=%v err=%v, want the reviewed row untouched", f.Description, ok, err)
		}
		if src.calls != 0 {
			t.Errorf("source consulted %d times for a reviewed row, want 0", src.calls)
		}
	})

	t.Run("clears a remembered miss", func(t *testing.T) {
		src := &countingProvider{foods: map[string]Food{}}
		p := NewCachingProvider(NewMemoryCache(), src)
		if _, ok, _ := p.Lookup(ctx, "sumac"); ok {
			t.Fatal("expected a miss")
		}
		src.foods["sumac"] = Food{Description: "Sumac, ground"}
		if _, ok, err := p.Refresh(ctx, "sumac"); !ok || err != nil {
			t.Fatalf("refresh after a miss: ok=%v err=%v", ok, err)
		}
		if f, ok, _ := p.Lookup(ctx, "sumac"); !ok || f.Description != "Sumac, ground" {
			t.Errorf("negative cache outlived the refresh")
		}
	})
}

func TestMemoryCacheProtectsReviewedRows(t *testing.T) {
	ctx := context.Background()
	c := NewMemoryCache()
	if err := c.PutFood(ctx, "flour", Food{Description: "hand-picked", Reviewed: true}); err != nil {
		t.Fatal(err)
	}
	if err := c.PutFood(ctx, "flour", Food{Description: "automatic"}); err != nil {
		t.Fatal(err)
	}
	if f, _, _ := c.Food(ctx, "flour"); f.Description != "hand-picked" {
		t.Errorf("reviewed row was overwritten with %q", f.Description)
	}
}
