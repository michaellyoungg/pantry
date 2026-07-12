package recipe

import (
	"context"
	"crypto/subtle"
	"net/http"
)

type ctxKey int

const userIDKey ctxKey = 0

// userIDFrom returns the authenticated user id placed on the request context by
// requireService. Empty if the middleware did not run (should not happen for
// routed requests other than /healthz).
func userIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}

// requireService gates every request behind the shared service secret and a
// non-empty user id, then stashes the user id on the context. /healthz is
// exempt so liveness probes need no credentials.
func requireService(secret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		got := r.Header.Get("X-Service-Secret")
		if subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		userID := r.Header.Get("X-User-Id")
		if userID == "" {
			writeError(w, http.StatusBadRequest, "missing user id")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDKey, userID)))
	})
}
