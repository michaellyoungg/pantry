package recipe

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// errPermanent marks a failure that retrying cannot fix, so the caller fails
// fast instead of spending the whole window on it. A malformed DSN is the
// motivating case: it will never become valid, and burning two minutes on it
// turns a clear configuration error into a slow, confusing one.
type errPermanent struct{ err error }

func (e errPermanent) Error() string { return e.err.Error() }
func (e errPermanent) Unwrap() error { return e.err }

// retryConnect calls connect until it succeeds, the window expires, the context
// is cancelled, or connect reports a permanent failure.
//
// This exists because a process that exits when the database is briefly
// unreachable at startup is permanently dead after any database restart: once
// the container runtime's restart budget is spent nothing brings it back, and
// the service stays down until a human notices. A Railway Postgres redeploy did
// exactly that to this service and to the Convex backend, which stayed down for
// twenty minutes with no traffic to explain it.
//
// The backoff doubles and is capped, so a database that comes back in a second
// is picked up in about a second, while one that is gone for a minute costs a
// handful of log lines rather than hundreds.
func retryConnect[T any](
	ctx context.Context,
	window time.Duration,
	initialBackoff time.Duration,
	connect func(context.Context) (T, error),
) (T, error) {
	const maxBackoff = 5 * time.Second

	var zero T
	deadline := time.Now().Add(window)
	backoff := initialBackoff
	attempt := 0

	for {
		attempt++
		v, err := connect(ctx)
		if err == nil {
			if attempt > 1 {
				slog.Info("database reachable", "attempts", attempt)
			}
			return v, nil
		}

		var perm errPermanent
		if errors.As(err, &perm) {
			return zero, err
		}
		if ctx.Err() != nil {
			return zero, fmt.Errorf("after %d attempts: %w", attempt, err)
		}
		if !time.Now().Add(backoff).Before(deadline) {
			return zero, fmt.Errorf("after %d attempts over %s: %w", attempt, window, err)
		}

		slog.Warn("database unreachable, retrying",
			"attempt", attempt, "retry_in", backoff.String(), "err", err)

		select {
		case <-ctx.Done():
			return zero, fmt.Errorf("after %d attempts: %w", attempt, err)
		case <-time.After(backoff):
		}
		if backoff *= 2; backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}
