package recipe

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const testSecret = "test-secret"

func TestMiddleware_RejectsMissingSecret(t *testing.T) {
	r := NewRouter(NewMemoryStore(), testSecret)
	req := httptest.NewRequest(http.MethodGet, "/recipes", nil)
	req.Header.Set("X-User-Id", "u1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestMiddleware_RejectsWrongSecret(t *testing.T) {
	r := NewRouter(NewMemoryStore(), testSecret)
	req := httptest.NewRequest(http.MethodGet, "/recipes", nil)
	req.Header.Set("X-Service-Secret", "nope")
	req.Header.Set("X-User-Id", "u1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestMiddleware_RejectsMissingUserId(t *testing.T) {
	r := NewRouter(NewMemoryStore(), testSecret)
	req := httptest.NewRequest(http.MethodGet, "/recipes", nil)
	req.Header.Set("X-Service-Secret", testSecret)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestMiddleware_HealthzBypassesAuth(t *testing.T) {
	r := NewRouter(NewMemoryStore(), testSecret)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
}

func TestMiddleware_AllowsGoodRequest(t *testing.T) {
	r := NewRouter(NewMemoryStore(), testSecret)
	req := httptest.NewRequest(http.MethodGet, "/recipes", nil)
	req.Header.Set("X-Service-Secret", testSecret)
	req.Header.Set("X-User-Id", "u1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
}
