package recipe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"syscall"
	"time"
)

// Import error sentinels. The handler maps these to HTTP status codes.
var (
	ErrImportBadURL      = errors.New("invalid or disallowed url")
	ErrImportFetch       = errors.New("could not fetch the url")
	ErrImportUnparseable = errors.New("could not extract a recipe from the page")
)

// Fetcher fetches a URL and returns the response body.
type Fetcher interface {
	Fetch(ctx context.Context, url string) ([]byte, error)
}

type httpFetcher struct {
	client   *http.Client
	maxBytes int64
}

// NewHTTPFetcher builds a fetcher whose dialer refuses loopback, private, and
// link-local addresses (SSRF guard). The check runs at connect time on the
// resolved IP, so DNS rebinding cannot slip past it.
func NewHTTPFetcher() *httpFetcher {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip != nil && isDisallowedIP(ip) {
				return ErrImportBadURL
			}
			return nil
		},
	}
	return &httpFetcher{
		client: &http.Client{
			Timeout:   10 * time.Second,
			Transport: &http.Transport{DialContext: dialer.DialContext},
			// Cap redirect chains.
			CheckRedirect: func(_ *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("%w: too many redirects", ErrImportFetch)
				}
				return nil
			},
		},
		maxBytes: 2 << 20, // 2 MiB
	}
}

func isDisallowedIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

func (f *httpFetcher) Fetch(ctx context.Context, rawURL string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("%w", ErrImportBadURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w", ErrImportBadURL)
	}
	req.Header.Set("User-Agent", "pantry-recipe-importer/1.0")
	resp, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, ErrImportBadURL) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %v", ErrImportFetch, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: status %d", ErrImportFetch, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, f.maxBytes))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrImportFetch, err)
	}
	return body, nil
}
