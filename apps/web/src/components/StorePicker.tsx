import { api } from "@pantry/convex/api";
import { useAsyncData } from "@pantry/core/react";
import { TEST_IDS } from "@pantry/core/testing";
import type { StoreLocation } from "@pantry/types";
import { useAction, useMutation, useQuery } from "convex/react";
import { type FormEvent, useCallback, useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

/**
 * Opting into real store prices (BL-0046).
 *
 * Renders nothing at all unless the deployment reports a configured price
 * provider, so a build without the feature flag — or without credentials —
 * offers no control rather than a dead one. Choosing a store is the whole
 * opt-in: with none chosen, the bill above is the national-average estimate it
 * has always been.
 */
export function StorePicker() {
  const readProvider = useAction(api.pricing.storeProvider);
  const loadProvider = useCallback(() => readProvider({}), [readProvider]);
  const { data: provider } = useAsyncData(loadProvider, []);

  const store = useQuery(api.pricing.getStore);
  const searchStores = useAction(api.pricing.searchStores);
  const selectStore = useMutation(api.pricing.selectStore);
  const clearStore = useMutation(api.pricing.clearStore);

  const [open, setOpen] = useState(false);
  const [zipCode, setZipCode] = useState("");
  const [stores, setStores] = useState<StoreLocation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const result = await searchStores({ zipCode });
      setStores(result.stores);
    } catch (err) {
      // The store directory being unreachable is a failure of this search
      // alone. The bill above is unaffected and still shows a total.
      setError(`Could not look up stores: ${String(err)}`);
    } finally {
      setSearching(false);
    }
  }

  async function choose(location: StoreLocation) {
    await selectStore({
      provider: provider?.provider ?? "",
      locationId: location.locationId,
      name: location.name,
      address: location.address,
    });
    setOpen(false);
    setStores(null);
  }

  if (!provider?.enabled) return null;

  if (store !== null && store !== undefined && !open) {
    return (
      <div className="mt-2 flex items-center gap-2" data-testid={TEST_IDS.list.storePicker.root}>
        <span className="text-xs text-muted">
          Priced at {store.name}
          {store.address ? `, ${store.address}` : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          testId={TEST_IDS.list.storePicker.open}
          onClick={() => setOpen(true)}
        >
          Change
        </Button>
        <Button
          variant="ghost"
          size="sm"
          testId={TEST_IDS.list.storePicker.clear}
          onClick={() => void clearStore({})}
        >
          Use averages
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-2" data-testid={TEST_IDS.list.storePicker.root}>
        <Button
          variant="ghost"
          size="sm"
          testId={TEST_IDS.list.storePicker.open}
          onClick={() => setOpen(true)}
        >
          Use my store's prices
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2" data-testid={TEST_IDS.list.storePicker.root}>
      <form className="flex items-center gap-2" onSubmit={(e) => void search(e)}>
        <Input
          className="w-28"
          inputMode="numeric"
          placeholder="Zip code"
          aria-label="Zip code"
          testId={TEST_IDS.list.storePicker.zip}
          value={zipCode}
          onChange={(e) => setZipCode(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          disabled={searching || zipCode.trim() === ""}
          testId={TEST_IDS.list.storePicker.search}
        >
          {searching ? "Searching…" : "Find stores"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </form>

      {error !== null && <ErrorText message={error} />}
      {stores !== null && stores.length === 0 && !searching && (
        <p className="mt-1 text-xs text-muted">No stores found near that zip code.</p>
      )}
      {stores !== null && stores.length > 0 && (
        <ul className="mt-1">
          {stores.map((location) => (
            <li key={location.locationId}>
              <Button
                variant="ghost"
                size="sm"
                testId={TEST_IDS.list.storePicker.store(location.locationId)}
                onClick={() => void choose(location)}
              >
                {location.name}
                {location.address ? ` — ${location.address}` : ""}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
