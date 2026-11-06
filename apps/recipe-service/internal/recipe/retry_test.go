package recipe

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A service that exits when Postgres is briefly unreachable at startup is
// permanently dead after any database restart, because nothing brings it back
// once the container runtime's restart budget is spent. That is not
// hypothetical: a Railway Postgres redeploy killed both recipe-service and the
// Convex backend, and the Convex backend stayed down for twenty minutes.

func TestRetryConnectSucceedsOnceTheDatabaseAppears(t *testing.T) {
	attempts := 0
	got, err := retryConnect(context.Background(), 2*time.Second, time.Millisecond,
		func(context.Context) (string, error) {
			attempts++
			if attempts < 3 {
				return "", errors.New("failed to lookup address information")
			}
			return "connected", nil
		})
	if err != nil {
		t.Fatalf("want success once the database appears, got %v", err)
	}
	if got != "connected" {
		t.Fatalf("want the value from the successful attempt, got %q", got)
	}
	if attempts != 3 {
		t.Fatalf("want 3 attempts, got %d", attempts)
	}
}

func TestRetryConnectGivesUpAndReturnsTheLastError(t *testing.T) {
	boom := errors.New("connection refused")
	attempts := 0
	_, err := retryConnect(context.Background(), 40*time.Millisecond, time.Millisecond,
		func(context.Context) (string, error) {
			attempts++
			return "", boom
		})
	if !errors.Is(err, boom) {
		t.Fatalf("want the last error wrapped, got %v", err)
	}
	if attempts < 2 {
		t.Fatalf("want more than one attempt before giving up, got %d", attempts)
	}
}

func TestRetryConnectStopsWhenTheContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	attempts := 0
	_, err := retryConnect(ctx, time.Minute, time.Millisecond,
		func(context.Context) (string, error) {
			attempts++
			if attempts == 2 {
				cancel()
			}
			return "", errors.New("still down")
		})
	if err == nil {
		t.Fatal("want an error when the context is cancelled")
	}
	if attempts > 5 {
		t.Fatalf("want to stop promptly on cancellation, got %d attempts", attempts)
	}
}

func TestRetryConnectDoesNotRetryAUsageError(t *testing.T) {
	// A malformed DSN will never become valid. Burning the whole window on it
	// turns a clear configuration error into a slow, confusing one.
	attempts := 0
	_, err := retryConnect(context.Background(), time.Minute, time.Millisecond,
		func(context.Context) (string, error) {
			attempts++
			return "", errPermanent{errors.New("parse dsn: invalid port")}
		})
	if err == nil {
		t.Fatal("want the permanent error returned")
	}
	if attempts != 1 {
		t.Fatalf("want exactly one attempt for a permanent error, got %d", attempts)
	}
}
