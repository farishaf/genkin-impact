import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/formatAmount";
import { AddTransactionForm } from "../../components/AddTransactionForm";
import {
  addDays, fromKey, isValidKey, newItemId, toKey, todayKey, weekStart,
  useCreatePage, useDay, useDeletePage, useEditDay, useEvents, usePages, useUpdateEvent,
  type Page, type Todo,
} from "../../lib/planner";
import { Checklist, Drawer, EventRow, Icon } from "./parts";

function dayKicker(date: string) {
  const diff = Math.round((fromKey(date).getTime() - fromKey(todayKey()).getTime()) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fromKey(date).toLocaleDateString("en-GB", { weekday: "long" });
}

function pageSub(p: Page) {
  if (p.checklist.length) return `${p.checklist.filter((c) => c.done).length}/${p.checklist.length} checked`;
  return p.description || "Empty page";
}

interface DayTxn {
  id: string;
  type: "expense" | "income" | "transfer";
  amount: string;
  currency_code: string;
  occurred_at: string;
  note: string | null;
  category_name: string | null;
  category_emoji: string | null;
  account_name: string;
}

// Keys start with "transactions" so AddTransactionForm's invalidation refreshes this card.
function DaySpending({ date }: { date: string }) {
  const [adding, setAdding] = useState(false);
  const txns = useQuery({
    queryKey: ["transactions", "day", date],
    queryFn: () => api.get<{ items: DayTxn[] }>(`/transactions?from=${date}&to=${date}&limit=50`).then((r) => r.items),
  });
  const spent = useQuery({
    queryKey: ["transactions", "day-summary", date],
    queryFn: () =>
      api
        .get<{ summary: { expenditure_minor: string; main_currency_code: string } }>(`/transactions/summary?type=expense&from=${date}&to=${date}`)
        .then((r) => r.summary),
    retry: false,
  });

  return (
    <section className="card mi-card mi-card--panel mi-cols__side mi-dayspend">
      <div className="mi-dayhead">
        <div className="mi-dayhead__titles">
          <span className="mi-kicker mi-kicker--money">Spent · {dayKicker(date)}</span>
          <span className="mi-money__total">{spent.data ? formatMoney(spent.data.expenditure_minor, spent.data.main_currency_code) : "—"}</span>
        </div>
        <button type="button" className="mi-solid" onClick={() => setAdding(true)}>
          + Transaction
        </button>
      </div>
      <div className="mi-sechead">
        <h2 className="mi-h2">Transactions</h2>
        <Link to="/mainichi/money/transactions" className="mi-textbtn">All</Link>
      </div>
      {txns.data?.length ? (
        <div className="mi-list mi-list--tight">
          {txns.data.map((t) => (
            <div key={t.id} className="mi-pagerow mi-txn">
              <span className="mi-tile">{t.category_emoji || (t.type === "transfer" ? "↔" : "🧾")}</span>
              <span className="mi-pagerow__text">
                <span className="mi-pagerow__title">{t.note || t.category_name || (t.type === "transfer" ? "Transfer" : "Expense")}</span>
                <span className="mi-pagerow__sub">
                  {new Date(t.occurred_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {t.account_name}
                </span>
              </span>
              <span className={`mi-txn__amt mi-txn__amt--${t.type}`}>
                {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}
                {formatMoney(t.amount, t.currency_code)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mi-empty">{txns.isLoading ? "Loading…" : "No transactions this day."}</p>
      )}
      {/* ponytail: the form always stamps "now"; pass a date into AddTransactionForm if backdating from here matters. */}
      {adding && (
        <Drawer title="New transaction" onClose={() => setAdding(false)}>
          <AddTransactionForm onDone={() => setAdding(false)} />
        </Drawer>
      )}
    </section>
  );
}

export function TodayPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const date = isValidKey(params.get("date")) ? params.get("date")! : todayKey();
  const setDate = (k: string) => setParams(k === todayKey() ? {} : { date: k }, { replace: true });

  const ws = weekStart(fromKey(date));
  const week = Array.from({ length: 7 }, (_, i) => toKey(addDays(ws, i)));
  const { data: events = [] } = useEvents(week[0], week[6]);
  const dayEvents = events.filter((e) => e.date === date);
  const [day, editDay] = useEditDay(date, useDay(date).data);
  const { data: pages = [] } = usePages();
  const createPage = useCreatePage();
  const deletePage = useDeletePage();
  const updateEvent = useUpdateEvent();

  const setTodos = (todos: Todo[], delay?: number) => editDay((d) => ({ ...d, todos }), delay);

  async function openAsPage(todo: Todo) {
    const page = await createPage.mutateAsync({ title: todo.text });
    editDay((d) => ({ ...d, todos: d.todos.map((t) => (t.id === todo.id ? { ...t, page_id: page.id } : t)) }), 0);
    navigate(`/mainichi/pages/${page.id}`);
  }

  async function newPage() {
    const page = await createPage.mutateAsync({});
    navigate(`/mainichi/pages/${page.id}`);
  }

  function removePage(p: Page) {
    if (window.confirm(`Delete "${p.title || "Untitled"}"? This can't be undone.`)) deletePage.mutate(p.id);
  }

  return (
    <div className="mi-cols">
    <section className="card mi-card mi-cols__main mi-today">
      <div className="mi-dayhead">
        <div className="mi-dayhead__titles">
          <span className="mi-kicker">{dayKicker(date)}</span>
          <h1 className="mi-h1">{fromKey(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h1>
        </div>
        {date !== todayKey() && (
          <button type="button" className="mi-pill" onClick={() => setDate(todayKey())}>
            Today
          </button>
        )}
        <button type="button" className="mi-iconbtn" aria-label="Previous day" onClick={() => setDate(toKey(addDays(fromKey(date), -1)))}>
          <Icon name="back" />
        </button>
        <button type="button" className="mi-iconbtn" aria-label="Next day" onClick={() => setDate(toKey(addDays(fromKey(date), 1)))}>
          <Icon name="chevron" />
        </button>
      </div>

      <div className="mi-week" role="group" aria-label="Pick a day">
        {week.map((k) => {
          const d = fromKey(k);
          const types = [...new Set(events.filter((e) => e.date === k).map((e) => e.type))];
          return (
            <button
              key={k}
              type="button"
              className={`mi-week__day${k === date ? " mi-week__day--sel" : ""}${k === todayKey() ? " mi-week__day--today" : ""}`}
              aria-pressed={k === date}
              aria-label={d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              onClick={() => setDate(k)}
            >
              <span className="mi-week__dow">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
              <span className="mi-week__num">{d.getDate()}</span>
              <span className="mi-dots">
                {types.map((t) => <span key={t} className={`mi-dot mi-type--${t}`} />)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mi-today__grid">
        <div className="mi-today__col">
          <div className="mi-sechead">
            <h2 className="mi-h2">To-do</h2>
            {day && day.todos.length > 0 && <span className="mi-count">{day.todos.filter((t) => t.done).length}/{day.todos.length}</span>}
          </div>
          {day ? (
            <Checklist
              items={day.todos}
              onChange={setTodos}
              makeItem={(text) => ({ id: newItemId(), text, done: false, page_id: null })}
              placeholder="Add a to-do, press Enter"
              renderExtra={(t) => {
                const page = t.page_id ? pages.find((p) => p.id === t.page_id) : undefined;
                return page ? (
                  <Link to={`/mainichi/pages/${page.id}`} className="mi-pill mi-pill--page" aria-label={`Open page ${page.title || "Untitled"}`}>
                    <span>{page.icon}</span>
                    {page.checklist.length > 0 && `${page.checklist.filter((c) => c.done).length}/${page.checklist.length}`}
                    <Icon name="chevron" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="icon-btn mi-check__act"
                    aria-label={`Open "${t.text}" as a page`}
                    title="Open as page"
                    onClick={() => openAsPage(t)}
                    disabled={createPage.isPending}
                  >
                    <Icon name="file" />
                  </button>
                );
              }}
            />
          ) : (
            <p className="muted">Loading…</p>
          )}

          <h2 className="mi-h2 mi-h2--spaced">Notes</h2>
          <textarea
            className="mi-notes"
            placeholder="How did the day go?"
            aria-label="Notes for the day"
            value={day?.notes ?? ""}
            disabled={!day}
            onChange={(e) => {
              const notes = e.target.value;
              editDay((d) => ({ ...d, notes }));
            }}
          />
        </div>

        <div className="mi-today__col">
          <div className="mi-sechead">
            <h2 className="mi-h2">From calendar</h2>
            <Link to={`/mainichi/calendar?date=${date}`} className="mi-textbtn">Open</Link>
          </div>
          {dayEvents.length === 0 ? (
            <p className="mi-empty">Rest day — nothing on the calendar.</p>
          ) : (
            <div className="mi-list">
              {dayEvents.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  onToggle={() => updateEvent.mutate({ id: e.id, done: !e.done })}
                  onEdit={() => navigate(`/mainichi/calendar?date=${e.date}&edit=${e.id}`)}
                />
              ))}
            </div>
          )}

          <div className="mi-sechead mi-sechead--spaced">
            <h2 className="mi-h2">Pages</h2>
            <button type="button" className="mi-textbtn" onClick={newPage} disabled={createPage.isPending}>+ New</button>
          </div>
          {pages.length === 0 ? (
            <p className="mi-empty">No pages yet.</p>
          ) : (
            <div className="mi-list mi-list--tight">
              {pages.map((p) => (
                <div key={p.id} className="mi-pageitem">
                  <Link to={`/mainichi/pages/${p.id}`} className="mi-pagerow">
                    <span className="mi-tile">{p.icon}</span>
                    <span className="mi-pagerow__text">
                      <span className="mi-pagerow__title">{p.title || "Untitled"}</span>
                      <span className="mi-pagerow__sub">{pageSub(p)}</span>
                    </span>
                    <Icon name="chevron" className="mi-pagerow__go" />
                  </Link>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger mi-check__del"
                    aria-label={`Delete page "${p.title || "Untitled"}"`}
                    onClick={() => removePage(p)}
                    disabled={deletePage.isPending}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {deletePage.error && <p className="field-error">{deletePage.error.message}</p>}
        </div>
      </div>
    </section>
    <DaySpending date={date} />
    </div>
  );
}
