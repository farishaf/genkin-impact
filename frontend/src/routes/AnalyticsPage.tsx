import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatAmount } from "../lib/formatAmount";
import { HeatmapCalendar, type AnalyticsDay } from "../components/HeatmapCalendar";
import { TrendChart } from "../components/TrendChart";

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

  return (
    <div className="page">
      <div className="page-head">
        <h1>Analytics</h1>
        <div className="head-spacer" />
        <button className="btn-outline btn-outline--sm" type="button" aria-label="Previous month" onClick={() => { setMonth((m) => shiftMonth(m, -1)); setSelectedDate(null); }}>
          ‹
        </button>
        <span className="seg">{monthLabel(month)}</span>
        <button className="btn-outline btn-outline--sm" type="button" aria-label="Next month" onClick={() => { setMonth((m) => shiftMonth(m, 1)); setSelectedDate(null); }}>
          ›
        </button>
      </div>

      {isSummaryError && <p className="field-error" style={{ margin: "0 var(--space-xl) var(--space-lg)" }}>Failed to load analytics. Try refreshing.</p>}

      {summary && (
        <div style={{ padding: "0 var(--space-xl) var(--space-2xl)" }}>
          <div className="card kv-card">
            <div className="kv-row"><span className="kv-row__k">Begin</span><span className="kv-row__v">{dayLabel(summary.days[0]?.date ?? month)}</span></div>
            <div className="kv-row"><span className="kv-row__k">End</span><span className="kv-row__v">{dayLabel(summary.days[summary.days.length - 1]?.date ?? month)}</span></div>
            <div className="kv-row">
              <span className="kv-row__k">Net this month</span>
              <span className={`kv-row__v${Number(summary.month_net_minor) > 0 ? " kv-row__v--gain" : Number(summary.month_net_minor) < 0 ? " kv-row__v--loss" : ""}`}>
                {Number(summary.month_net_minor) > 0 ? "+" : ""}
                {formatAmount(summary.month_net_minor, summary.main_currency_code)} {summary.main_currency_code}
              </span>
            </div>
          </div>

          <div className="card panel">
            <div className="panel__head">
              <span className="panel__title">{selectedDay ? dayLabel(selectedDay.date) : "Select a day"}</span>
              {selectedDay && (
                <span className={`day-pill${selectedDay.sign === "gain" ? " day-pill--gain" : selectedDay.sign === "loss" ? " day-pill--loss" : ""}`}>
                  {selectedDay.sign === "gain" ? "+" : ""}
                  {formatAmount(selectedDay.net_minor, summary.main_currency_code)}
                </span>
              )}
            </div>
            <HeatmapCalendar days={summary.days} selectedDate={selectedDate} onSelectDay={setSelectedDate} currencyCode={summary.main_currency_code} />
            <div className="legend-row">
              <span className="legend-item"><span className="legend-swatch" data-tone="loss" /> Loss (spend &gt; income)</span>
              <span className="legend-item"><span className="legend-swatch" data-tone="neutral" /> No activity</span>
              <span className="legend-item"><span className="legend-swatch" data-tone="gain" /> Gain (income &gt; spend)</span>
            </div>
          </div>

          <div className="card panel">
            <span className="panel__label">Daily Net Trend</span>
            <TrendChart days={summary.days} />
            <div className="chart-months">
              {tickDays.map((d) => (
                <span key={d.date}>{new Date(`${d.date}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
              ))}
            </div>
          </div>

          {selectedDay && (
            <div className="card panel">
              <div className="tile-grid">
                <div className="card stat-card">
                  <div className="stat-card__label">Expenditure</div>
                  <div className="stat-card__figure" style={{ color: "var(--color-loss)" }}>
                    {formatAmount(selectedDay.expenditure_minor, summary.main_currency_code)}
                  </div>
                </div>
                <div className="card stat-card">
                  <div className="stat-card__label">Income</div>
                  <div className="stat-card__figure" style={{ color: "var(--color-gain)" }}>
                    {formatAmount(selectedDay.income_minor, summary.main_currency_code)}
                  </div>
                </div>
              </div>
              <div className="card txn-card" style={{ marginTop: "var(--space-sm)" }}>
                {isDayLoading && <p className="muted">Loading…</p>}
                {dayTxns?.map((t) => (
                  <div className="txn-row" key={t.id}>
                    <span className="cat-badge">{(t.category_name ?? t.account_name).charAt(0).toUpperCase()}</span>
                    <div className="txn-row__body">
                      <div className="txn-row__top">
                        <span className="txn-row__cat">{t.category_name ?? "Transfer"}</span>
                        <span className="txn-row__time">{new Date(t.occurred_at).toLocaleTimeString()}</span>
                      </div>
                      {t.note && <div className="txn-row__note">{t.note}</div>}
                    </div>
                    <span className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}>
                      {t.type === "expense" ? "-" : "+"}
                      {formatAmount(t.amount, t.currency_code)}
                    </span>
                  </div>
                ))}
                {dayTxns?.length === 0 && <p className="muted">No transactions this day.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
