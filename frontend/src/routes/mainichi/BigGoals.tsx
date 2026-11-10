import { useState } from "react";
import { fromKey, newItemId, todayKey, useEditGoals, useGoals, type Goal } from "../../lib/planner";
import { confirmDialog } from "../../components/ConfirmDialog";
import { Icon, Skeleton } from "./parts";

const MAX_GOALS = 20; // matches the backend limit

/** The few long-term goals for the year, above the day: numbered cards, edited in place. */
export function BigGoals() {
  const query = useGoals();
  const [goals, edit] = useEditGoals(query.data);
  const [editing, setEditing] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);

  const today = fromKey(todayKey());
  const year = today.getFullYear();
  const daysLeft = Math.round((new Date(year, 11, 31).getTime() - today.getTime()) / 864e5);

  const set = (id: string, patch: Partial<Goal>) => edit((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  function add() {
    const id = newItemId();
    edit((gs) => [...gs, { id, title: "", note: "" }], 0);
    setNewId(id);
    setEditing(true);
  }
  async function remove(g: Goal) {
    if (g.title.trim() && !(await confirmDialog({ title: `Remove "${g.title}"?`, confirmLabel: "Remove goal", danger: true }))) return;
    edit((gs) => gs.filter((x) => x.id !== g.id), 0);
  }
  function finish() {
    // Cards left blank are dropped rather than saved as empty goals.
    if (goals?.some((g) => !g.title.trim() && !g.note.trim())) edit((gs) => gs.filter((g) => g.title.trim() || g.note.trim()), 0);
    setEditing(false);
    setNewId(null);
  }

  return (
    <section className="mi-goals" aria-label="Big goals">
      <div className="mi-goals__head">
        <div className="mi-goals__titles">
          <span className="mi-goals__kicker">Big goals</span>
          <span className="mi-goals__year">{year}</span>
          <span className="mi-muted">{daysLeft === 0 ? "Last day of the year" : `${daysLeft} days left this year`}</span>
        </div>
        {goals && goals.length > 0 && (
          <div className="mi-goals__acts">
            {editing && (
              <button type="button" className="mi-textbtn" onClick={add} disabled={goals.length >= MAX_GOALS}>+ Add</button>
            )}
            <button type="button" className={`mi-pill${editing ? " mi-pill--on" : ""}`} onClick={editing ? finish : () => setEditing(true)}>
              {editing ? "Done" : "Edit"}
            </button>
          </div>
        )}
      </div>

      <div className="mi-goals__strip">
        {query.isLoading ? (
          <Skeleton rows={3} height="8.5rem" className="mi-goals__skel" />
        ) : !goals ? (
          <p className="mi-empty">Couldn't load goals.</p>
        ) : goals.length === 0 ? (
          <button type="button" className="mi-goal mi-goal--new" onClick={add}>
            <strong>+ Set a big goal</strong>
            <span className="mi-goal__note">What should {year} be about? A race, an exam, a number in the bank.</span>
          </button>
        ) : (
          goals.map((g, i) => (
            <article key={g.id} className="mi-goal">
              <div className="mi-goal__top">
                <span className="mi-goal__num">{String(i + 1).padStart(2, "0")}</span>
                {editing && (
                  <button type="button" className="icon-btn icon-btn--danger" aria-label={`Remove goal ${g.title || i + 1}`} onClick={() => remove(g)}>
                    <Icon name="x" />
                  </button>
                )}
              </div>
              {editing ? (
                <>
                  <textarea
                    className="mi-goal__title-input"
                    rows={1}
                    maxLength={200}
                    value={g.title}
                    placeholder="Goal"
                    aria-label={`Goal ${i + 1}`}
                    autoFocus={g.id === newId}
                    onChange={(e) => set(g.id, { title: e.target.value })}
                  />
                  <textarea
                    className="mi-goal__note-input"
                    rows={2}
                    maxLength={2000}
                    value={g.note}
                    placeholder="Why it matters / how"
                    aria-label={`Why goal ${i + 1} matters`}
                    onChange={(e) => set(g.id, { note: e.target.value })}
                  />
                </>
              ) : (
                <>
                  <span className="mi-goal__title">{g.title || "Untitled goal"}</span>
                  {g.note && <p className="mi-goal__note">{g.note}</p>}
                </>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
