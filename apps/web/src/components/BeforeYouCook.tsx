import { useAsyncAction } from "@pantry/core/react";
import { dueByToday, formatDueOn, stateKey } from "../lib/prep";
import { usePlanPrep } from "../lib/usePlanPrep";
import { ErrorText } from "./ErrorText";
import { PrepSourceBadge } from "./PrepSourceBadge";

/**
 * "Before you cook" (BL-0042): the lead-time prep due today for this week's
 * plan, with check-off.
 *
 * The card exists because a derived task is worthless at the moment you need
 * it — "take the chicken out tonight" has to be said tonight. So it shows what
 * is due TODAY (and what was due earlier and never ticked), never the whole
 * week's prep, which would be a wall of things that are not yet actionable.
 *
 * Renders NOTHING when there is nothing to do, like UseItUp: Home offers one
 * next action, and an empty prep card would compete with it for no reason.
 */
export function BeforeYouCook() {
  const { meals, today, done, setDone, loading, error } = usePlanPrep();
  const act = useAsyncAction();

  const due = dueByToday(meals, today);
  const outstanding = due.filter((d) => !done.has(stateKey(d.task.key, d.cookDate)));

  // Nothing due means no card at all — no empty state and no zero badge, the
  // same rule UseItUp follows. But a card whose tasks are all TICKED still
  // renders: hiding it the instant the last box is checked would take the undo
  // away with it, and the list is what the user just interacted with. It goes
  // away on its own tomorrow, when the tasks stop being due.
  if (loading || due.length === 0) return null;

  return (
    <section
      aria-label="Before you cook"
      className="rounded-xl border border-primary/40 bg-primary/5 p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-text">
        {outstanding.length === 0
          ? "Prep for today is done"
          : outstanding.length === 1
            ? "1 thing to do before you cook"
            : `${outstanding.length} things to do before you cook`}
      </h2>

      <ul className="mt-3 flex flex-col gap-2">
        {due.map((d) => {
          const checked = done.has(stateKey(d.task.key, d.cookDate));
          const label = `${d.task.text} for ${d.title}`;
          return (
            <li key={stateKey(d.task.key, d.cookDate)} className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={label}
                checked={checked}
                onChange={() => act.run(() => setDone(d.task.key, d.cookDate, !checked))}
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="text-sm">
                <span className={checked ? "text-muted line-through" : "text-text"}>
                  {d.task.text}
                </span>
                {/* Provenance (BL-0044). A derived task that is wrong for this
                    recipe is fixable on the recipe form; unlabelled, it just
                    looks like the app being wrong. */}
                <PrepSourceBadge source={d.task.source} />{" "}
                <span className="text-muted">
                  for {d.title} —{" "}
                  {/* A missed window is called out, never hidden. Finding out at
                      dinner time is the failure this whole feature prevents. */}
                  <span className={d.task.missed ? "font-medium text-red-600" : ""}>
                    {formatDueOn(d.task.dueOn, today)}
                  </span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <ErrorText message={act.error ?? error} />
    </section>
  );
}
