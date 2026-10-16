import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatAmount, formatMoney } from "../lib/formatAmount";
import { HeatmapCalendar, type AnalyticsDay } from "../components/HeatmapCalendar";
import { TrendChart } from "../components/TrendChart";
import { ChevronIcon } from "../components/TxnIcons";
import { SummaryHero } from "../components/SummaryHero";
import { hueStyle } from "../lib/categoryHue";

interface AnalyticsSummary {
  month: string;
  main_currency_code: string;
  days: AnalyticsDay[];
  month_income_minor: string;
  month_expenditure_minor: string;
  month_net_minor: string;
}

interface TxnItem {
  id: string;
  type: string;
  amount: string;
  currency_code: string;
  occurred_at: string;
  note: string | null;
  category_name: string | null;
  account_name: string;
}

function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function isToday(date: string): boolean {
  return date === new Date().toISOString().slice(0, 10);
}

// eastern convention hardcoded (gain=red, loss=green) per explicit product ask; users.color_convention
// exists in the schema for a future toggle but has no settings UI yet, so it isn't wired up here.
export function AnalyticsPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: summary, isError: isSummaryError } = useQuery({
    queryKey: ["analytics", "summary", month],
    queryFn: () => api.get<AnalyticsSummary>(`/analytics/summary?month=${month}`),
  });

  const { data: dayTxns, isLoading: isDayLoading } = useQuery({
    queryKey: ["transactions", "list", selectedDate],
    queryFn: () => api.get<{ items: TxnItem[] }>(`/transactions?from=${selectedDate}&to=${selectedDate}`).then((r) => r.items),
    enabled: !!selectedDate,
  });

  const selectedDay = summary?.days.find((d) => d.date === selectedDate) ?? null;
  const tickDays = summary && summary.days.length >= 4
    ? [0, Math.floor(summary.days.length / 3), Math.floor((2 * summary.days.length) / 3), summary.days.length - 1].map((i) => summary.days[i])
    : summary?.days ?? [];

  function changeMonth(delta: number) {
    setMonth((m) => shiftMonth(m, delta));
    setSelectedDate(null);
  }

  return (
    <div className="txn-page">
      <div className="txn-page__content">
        <header className="page-head">
          <div className="page-head__titles">
            <span className="eyebrow eyebrow--accent">Patterns</span>
            <h1>Insights</h1>
          </div>
          <div className="page-head__actions">
            <div className="month-stepper" role="group" aria-label="Month">
              <button className="icon-btn" type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>
                <span className="chevron--back">
                  <ChevronIcon />
                </span>
              </button>
              <span className="month-stepper__label">{monthLabel(month)}</span>
              <button className="icon-btn" type="button" aria-label="Next month" onClick={() => changeMonth(1)}>
                <ChevronIcon />
              </button>
            </div>
          </div>
        </header>

        {isSummaryError && <p className="field-error">Failed to load analytics. Try refreshing.</p>}

        {summary && (
          <div className="stack">
            <SummaryHero
              rangeLabel={monthLabel(month)}
              summary={{
                income_minor: summary.month_income_minor,
                expenditure_minor: summary.month_expenditure_minor,
                balance_minor: summary.month_net_minor,
                main_currency_code: summary.main_currency_code,
              }}
            />

            <div className="card panel">
              <div className="panel__head">
                <div>
                  <span className="eyebrow">Daily heatmap</span>
                  <div className="panel__title">Your month at a glance</div>
                </div>
                <span className="panel__hint">Tap a day</span>
              </div>
              <HeatmapCalendar days={summary.days} selectedDate={selectedDate} onSelectDay={setSelectedDate} currencyCode={summary.main_currency_code} />
              <div className="legend-row">
                <span className="legend-item"><span className="legend-swatch" data-tone="loss" /> Spent more</span>
                <span className="legend-item"><span className="legend-swatch" data-tone="neutral" /> Quiet day</span>
                <span className="legend-item"><span className="legend-swatch" data-tone="gain" /> Earned more</span>
              </div>
            </div>

            <div className="card panel">
              <div className="panel__head">
                <div>
                  <span className="eyebrow">Daily net</span>
                  <div className="panel__title">Trend</div>
                </div>
              </div>
              <TrendChart days={summary.days} />
              <div className="chart-months">
                {tickDays.map((d) => (
                  <span key={d.date}>{new Date(`${d.date}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="right">
        <div className="right-inner">
          <div className="right-head">
            <span className="eyebrow eyebrow--accent">Day detail</span>
            <h2 className="right-title">{selectedDay ? (isToday(selectedDay.date) ? "Today" : dayLabel(selectedDay.date)) : "Pick a day"}</h2>
          </div>

          {!selectedDay && <p className="muted muted--flush">Tap any square in the heatmap to see what happened that day.</p>}

          {selectedDay && summary && (
            <>
              <div className="tile-grid">
                <div className="stat-tile">
                  <span className="eyebrow"><span className="dot" data-tone="expense" /> Out</span>
                  <div className="stat-tile__figure num">
                    {formatAmount(selectedDay.expenditure_minor, summary.main_currency_code)}
                  </div>
                </div>
                <div className="stat-tile">
                  <span className="eyebrow"><span className="dot" data-tone="income" /> In</span>
                  <div className="stat-tile__figure num">
                    {formatAmount(selectedDay.income_minor, summary.main_currency_code)}
                  </div>
                </div>
              </div>

              <div className="txn-group__head">
                <span className="eyebrow">Net for the day</span>
                {selectedDay.sign !== "neutral" && (
                  <span className="txn-group__pill" data-tone={selectedDay.sign === "gain" ? "positive" : "negative"}>
                    {selectedDay.sign === "gain" ? "+" : ""}
                    {formatAmount(selectedDay.net_minor, summary.main_currency_code)}
                  </span>
                )}
              </div>

              <div className="card txn-card">
                {isDayLoading && <p className="muted">Loading…</p>}
                {dayTxns?.map((t) => (
                  <div className="txn-row" key={t.id}>
                    <span className="cat-badge" data-kind={t.type} style={hueStyle(t.category_name ?? t.account_name)}>
                      {(t.category_name ?? t.account_name).charAt(0).toUpperCase()}
                    </span>
                    <div className="txn-row__body">
                      <div className="txn-row__top">
                        <span className="txn-row__cat">{t.category_name ?? "Transfer"}</span>
                        <span className="txn-row__time">{new Date(t.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {t.note && <div className="txn-row__note">{t.note}</div>}
                      <div className="chip-row">
                        <span className="chip-acct">{t.account_name}</span>
                      </div>
                    </div>
                    <div className="txn-row__end">
                      <span className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}>
                        {t.type === "expense" ? "-" : "+"}
                        {formatMoney(t.amount, t.currency_code)}
                      </span>
                    </div>
                  </div>
                ))}
                {dayTxns?.length === 0 && <p className="muted">No transactions this day.</p>}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
