package recipe

import "testing"

func TestParseISODurationMinutes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want *int
	}{
		{"minutes", "PT30M", intPtr(30)},
		{"hours and minutes", "PT1H30M", intPtr(90)},
		{"hours only", "PT2H", intPtr(120)},
		{"lowercase", "pt45m", intPtr(45)},
		{"zero day part", "P0DT45M", intPtr(45)},
		{"days", "P1D", intPtr(1440)},
		{"fractional hours", "PT1.5H", intPtr(90)},
		{"seconds round up", "PT90S", intPtr(2)},
		{"empty", "", nil},
		{"garbage", "30 minutes", nil},
		{"bare P", "P", nil},
		// Zero is "instant", which no recipe is; treat it as unknown rather than
		// letting a recipe claim it takes no time at all.
		{"zero", "PT0M", nil},
		{"absurd", "P52W", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseISODurationMinutes(tc.in)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("parseISODurationMinutes(%q) = %d, want nil", tc.in, *got)
			case tc.want != nil && got == nil:
				t.Fatalf("parseISODurationMinutes(%q) = nil, want %d", tc.in, *tc.want)
			case tc.want != nil && *got != *tc.want:
				t.Fatalf("parseISODurationMinutes(%q) = %d, want %d", tc.in, *got, *tc.want)
			}
		})
	}
}

func TestTotalMinutesFromPrefersTotalTime(t *testing.T) {
	got := totalMinutesFrom("PT50M", "PT10M", "PT20M")
	if got == nil || *got != 50 {
		t.Fatalf("got %v, want 50 — totalTime is the figure the chip means", got)
	}
}

func TestTotalMinutesFromSumsPrepAndCookWhenTotalIsMissing(t *testing.T) {
	got := totalMinutesFrom("", "PT10M", "PT20M")
	if got == nil || *got != 30 {
		t.Fatalf("got %v, want 30", got)
	}
}

func TestTotalMinutesFromUsesWhicheverPartIsPresent(t *testing.T) {
	got := totalMinutesFrom("", "", "PT25M")
	if got == nil || *got != 25 {
		t.Fatalf("got %v, want 25", got)
	}
}

func TestTotalMinutesFromReturnsNilWhenNothingParses(t *testing.T) {
	if got := totalMinutesFrom("", "soon", ""); got != nil {
		t.Fatalf("got %d, want nil", *got)
	}
}
