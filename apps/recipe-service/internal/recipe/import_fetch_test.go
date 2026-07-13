package recipe

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPFetcher_RejectsNonHTTPScheme(t *testing.T) {
	_, err := NewHTTPFetcher().Fetch(context.Background(), "file:///etc/passwd")
	if !errors.Is(err, ErrImportBadURL) {
		t.Fatalf("err = %v, want ErrImportBadURL", err)
	}
}

func TestHTTPFetcher_RejectsLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html></html>"))
	}))
	defer srv.Close()
	// srv.URL points at 127.0.0.1 — the SSRF guard must refuse to dial it.
	if _, err := NewHTTPFetcher().Fetch(context.Background(), srv.URL); err == nil {
		t.Fatal("expected loopback fetch to be rejected")
	}
}

func TestHTTPFetcher_ReadsBodyWithSizeCap(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>hello</html>"))
	}))
	defer srv.Close()
	f := &httpFetcher{client: srv.Client(), maxBytes: 4} // client bypasses the SSRF dialer
	body, err := f.Fetch(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body) != 4 {
		t.Fatalf("body len = %d, want 4 (size cap)", len(body))
	}
}
