# Unifying the two pantry suggestion surfaces

- **Backlog item:** [BL-0050](../../backlog/BL-0050-unify-pantry-suggestion-surfaces.md)
- **Supersedes on this point:** [pantry shelf-life & expiry](2026-08-03-pantry-shelf-life-expiry-design.md) §"cook these"
- **Extends:** [recommendations](2026-08-03-recommendations-design.md) — `expiryUrgency`, listed there as unavailable, becomes available
- **Date:** 2026-08-03

## Summary

`/pantry` renders two cards that both answer "what should I cook to use things
up", built by different agents and merged without ever having been designed
together. This spec collapses them into one, and it does so by **routing the
expiry-driven card through the recommendation ranker** rather than by picking a
winner.

The reason to do it this way is not tidiness. `POST /recipes/using` applies no
preference filtering, so today one card on `/pantry` removes recipes containing
an avoided ingredient while the other, a few hundred pixels below, can recommend
exactly such a recipe. The avoid list is where this product touches allergies.
Once it is promised on a screen, a surface on that same screen that ignores it is
**broken, not merely unfiltered** — and it is worse than either behaviour alone,
because the visible filtering teaches the user to trust a guarantee the adjacent
card does not honour.

So: one endpoint, one filter, one card. The IA improvement follows from the
correctness fix rather than motivating it.

## Which signal wins

Expiry urgency and preference fit are different signals, and the merged surface
has to say which one wins when they disagree. Three rules, in order.

**1. The avoid list beats everything, always.** It stays a hard pre-filter that
runs before scoring, never a weight. No amount of urgency may surface an
avoided ingredient: a recipe you cannot eat is not a use for spinach that is
going off, it is a recipe you cannot eat. This rule is why the work exists, and
after this change there is exactly one code path that can produce a pantry
suggestion, so there is exactly one place the rule has to hold.

**2. Below that, urgency beats fit.** `expiryUrgency` carries the highest weight
in the pantry ranker — above `useItUpHits`, itself above `coverage`. The two are
not the same kind of claim and their errors do not cost the same:

- "You'd like this" is a *prediction about taste*. Being wrong costs a shrug and
  a scroll to the next row. The user can recover, immediately and for free.
- "This spoils in two days" is a *fact about the physical world with a
  deadline*. Being wrong costs food in the bin, and tomorrow is too late. The
  user cannot recover.

Ranking by which error is recoverable is what makes urgency the tiebreak. It is
also the honest reading of the screen the user is on: someone looking at
`/pantry` is not browsing for something delicious, they are looking at food they
already own.

**3. Urgency outranks the explicit use-it-up flag, narrowly.** Both express "use
this first", and when both apply they agree — a flagged item that is also
expiring scores on both features. They only disagree when the user has flagged
one thing while a *different* thing is quietly going off, and there the deadline
wins, because the flag is a preference about priority and the date is a
constraint. The gap is deliberately small (3.5 vs 3.0): the user's explicit
instruction is not being overruled so much as narrowly outweighed by a fact they
may not have noticed.

### …and the UI still says both

Weights decide *order*. They must not be allowed to decide *vocabulary* — a card
that ranks by urgency but explains itself with "uses 4 things you have" has
silently thrown the urgency away. So urgency is carried out of the ranker as a
**structured field**, not folded into the free-text `reasons` array with
everything else:

```go
// Result
Urgency *Urgency `json:"urgency,omitempty"`
```

That lets the card render "Use soon — spinach (~2 days)" as its own amber line,
visually distinct from the muted fit line beneath it, without string-matching a
reason. Keeping the two claims typographically separate is the whole point of
merging the cards deliberately instead of deleting one at random.

## Design

### Expiry becomes a ranker feature

The recommendations design already reserved `expiryUrgency` and marked it
unavailable pending BL-0029. BL-0029 has since shipped `pantryItems.useBy`, so
the feature's backing data now exists and the seam gets used exactly as
intended — a pure addition, no rescoring of anything else.

`recommend` stays **stateless and dependency-free**: it learns about time the
same way it learns about everything else, from the request body.

```
PantryItem  += useBy?: number   // epoch ms, absent when shelf life is unknown
UserContext += now:    number   // epoch ms, the caller's clock
```

Urgency per pantry item, mirroring `apps/web/src/lib/expiry.ts` so the card's
amber strip and the ranker agree on what "this week" means:

```
overdue or due today  → 1.0
at/after the horizon  → 0.0   (EXPIRY_HORIZON_DAYS = 7)
between               → linear
```

**Per candidate, urgency is the MAX over the ingredients it uses, not the sum.**
A sum would rank a recipe using four mildly-aging things above the one recipe
that saves the spinach dying tomorrow, which inverts the signal precisely when
it matters most. The question the feature answers is "how urgent is the most
urgent thing this clears", and max is that question.

**Availability is decided per request, not per candidate.** The feature is
available when the caller sent a clock *and* at least one owned row carries a
`useBy`. If availability were computed per candidate, two candidates in the same
response would be normalized by different weight denominators and their scores
would not be comparable — the exact failure `combine()` exists to prevent. When
no pantry row has a date (nothing in the dictionary knows the user's items), the
feature reports unavailable, drops out of both numerator and denominator, and
the ranking is byte-identical to today's.

A missing `now` also reports unavailable rather than defaulting to the server
clock. Absent data must degrade to "no signal", never to a guess: epoch zero
would mark every item in the fridge as fifty years overdue.

### One endpoint

`POST /recipes/using` and the Convex action `pantry.recipesToUse` are
**deleted**, not filtered.

The backlog item offered "at minimum, apply the avoid list to `/recipes/using`"
as a fallback. That was the right floor to name and it is the wrong place to
stop, because it leaves two ranking notions and — worse — leaves an unfiltered
recipe-search endpoint sitting in the service. The next feature that wants
"recipes using X" would reach for it and reintroduce this bug, having no way to
know that the safe version of that query is `/recommendations/pantry`. Removing
it makes the safe path the only path.

The isolation property its tests pinned (one user's recipes never leak into
another's suggestions) is preserved: `recommendCandidates` reads
`ListRecipes(userID)` plus the shared catalog, the same split, and keeps its own
test.

### One card, two placements

`<UseItUp />` survives as the single component; `<UseItUpSuggestions />` is
deleted. Keeping the *name* of the expiry card and the *engine* of the
recommendations card means `Home.tsx` needs no edit at all, which matters with
several agents landing work into these files concurrently.

The two placements genuinely differ, so one prop distinguishes them:

| | `variant="nudge"` (default — Home) | `variant="page"` (`/pantry`) |
| --- | --- | --- |
| When nothing is expiring | renders `null`, asks for nothing | renders, asks anyway |
| Role | an interrupt | the home of the feature |

Home's rule is load-bearing and is inherited from BL-0029: Home offers *one*
next action, and a permanent suggestion card there would compete with the weekly
loop. It stays an interrupt that appears only when there is genuinely food about
to be wasted — and, as a consequence of the gate, costs no request on the common
path where nothing is expiring.

### Suggestions load automatically

The expiry card auto-loaded; the recommendations card required clicking "What
can I make?". One card cannot have two interaction models, and the choice is
forced: Home must not have a button, because a card that renders only when
something is about to spoil and *then* asks the user to press a button before
telling them what to do about it is the "alert with nothing to do about it"
BL-0029 exists to avoid.

So both auto-load, refetching when pantry contents change — which is also what
the recommendations design asks for ("the web surface refetches when pantry
contents change so it does not look stale in an otherwise-live app"). The
explicit button is removed rather than kept as a redundant refresh.

### Degradation is unchanged

Recommendations remain additive: the card is `<section>`-scoped, and a failed or
slow ranker collapses it to its items list — the expiring-items strip is derived
from local Convex state and is useful with no network call at all. The rest of
`/pantry` is untouched. Empty stays a first-class state distinct from failure.

## Testing

- **Go unit** (`internal/recommend`) — urgency curve at the boundaries (overdue,
  today, mid-horizon, past horizon); max-not-sum across a candidate's
  ingredients; unavailable-when-no-dates leaves ordering identical to the
  no-expiry case; an avoided ingredient is removed even when it is the most
  urgent thing in the fridge. Weights re-pinned.
- **Go handler** — `/recommendations/pantry` still isolates users from each
  other; `/recipes/using` is gone (404).
- **Convex unit** — the action forwards `useBy` and `now`.
- **Web unit** — `nudge` renders nothing with nothing expiring and does not
  fetch; `page` renders regardless; urgency renders as its own line, separate
  from the fit reasons.
- **E2E** — the avoid-list spec keeps its baseline-then-absence shape; its
  card locator no longer needs to disambiguate two cards, because there is one.

## Alternatives considered

- **Filter `/recipes/using` and keep both cards.** The backlog item's stated
  floor. Fixes the safety bug and nothing else: two code paths, two notions of
  ranking, two cards with near-identical names, and a trap left in the service
  for the next feature. Rejected as a stopping point, not as a first step.
- **Delete `<UseItUp />`, keep the recommendations card.** Loses expiry entirely
  until someone wires shelf life into scoring — which is most of this spec's
  work anyway, so the deletion would be a regression paid for nothing.
- **Delete `<UseItUpSuggestions />`, keep the expiry card.** Loses preference
  filtering, i.e. deletes the correct half.
- **Fold urgency into the `reasons` strings.** Cheapest merge, one field fewer.
  Rejected: it makes "use this soon" and "you'd like this" the same kind of
  string, so the UI can only tell them apart by prefix-matching English. The
  distinction is the thing being designed here; it should be typed.
- **Sum urgency across matched ingredients.** Rewards breadth over deadline —
  see above. Max is the question actually being asked.
- **Keep the "What can I make?" button on `/pantry` only.** Two interaction
  models for one component, and the divergence would have to be justified on
  every future change to the card. The auto-load is cheap and it is what the
  recommendations design specified.
