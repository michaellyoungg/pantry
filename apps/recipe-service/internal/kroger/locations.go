package kroger

import (
	"context"
	"net/url"
	"strconv"
	"strings"

	"pantry/apps/recipe-service/internal/pricing"
)

const (
	defaultRadiusMiles = 10
	maxRadiusMiles     = 100
	maxStoreResults    = 10
)

type locationSearch struct {
	Data []location `json:"data"`
}

type location struct {
	LocationID string `json:"locationId"`
	Chain      string `json:"chain"`
	Name       string `json:"name"`
	Address    struct {
		AddressLine1 string `json:"addressLine1"`
		City         string `json:"city"`
		State        string `json:"state"`
		ZipCode      string `json:"zipCode"`
	} `json:"address"`
}

// SearchStores finds stores near a zip code so the user can pick one. This is
// the only place a price becomes possible: without a locationId Kroger returns
// no price at all, which is what makes real prices inherently opt-in.
//
// Unlike Quote this may return an error. It answers a deliberate user action
// with its own screen, where "we could not reach the store list" is honest;
// pricing a grocery list is the path that must never fail.
func (c *Client) SearchStores(
	ctx context.Context, zipCode string, radiusMiles int,
) ([]pricing.StoreLocation, error) {
	zip := strings.TrimSpace(zipCode)
	if zip == "" {
		return nil, nil
	}
	if radiusMiles <= 0 {
		radiusMiles = defaultRadiusMiles
	}
	if radiusMiles > maxRadiusMiles {
		radiusMiles = maxRadiusMiles
	}
	query := url.Values{
		"filter.zipCode.near":  {zip},
		"filter.radiusInMiles": {strconv.Itoa(radiusMiles)},
		"filter.limit":         {strconv.Itoa(maxStoreResults)},
	}
	var body locationSearch
	// The store list is not cached: it is fetched once, when a user is actively
	// choosing, and holding it would be a copy of API content for no gain.
	if _, err := c.get(ctx, "/locations", query, &body); err != nil {
		return nil, err
	}
	out := make([]pricing.StoreLocation, 0, len(body.Data))
	for _, l := range body.Data {
		if l.LocationID == "" {
			continue
		}
		out = append(out, pricing.StoreLocation{
			LocationID: l.LocationID,
			Name:       storeName(l),
			Chain:      l.Chain,
			Address:    l.Address.AddressLine1,
			City:       l.Address.City,
			State:      l.Address.State,
			ZipCode:    l.Address.ZipCode,
		})
	}
	return out, nil
}

// storeName falls back to the city when a store has no name of its own, so the
// chooser never shows a blank row next to a radio button.
func storeName(l location) string {
	if name := strings.TrimSpace(l.Name); name != "" {
		return name
	}
	if city := strings.TrimSpace(l.Address.City); city != "" {
		return city
	}
	return l.LocationID
}
