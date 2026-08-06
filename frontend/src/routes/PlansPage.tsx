import { useState } from "react";
import { BudgetsTab } from "../components/BudgetsTab";
import { SavingsTab } from "../components/SavingsTab";
import { RecurringTab } from "../components/RecurringTab";

const TABS = [
  { key: "budgets", label: "Budgets" },
  { key: "savings", label: "Savings Goals" },
  { key: "recurring", label: "Recurring" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function PlansPage() {
  const [tab, setTab] = useState<TabKey>("budgets");

  return (
    <div className="page">
      <div className="page-head">
        <h1>Plans</h1>
      </div>
      <div className="plans-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            className={`plans-tab${tab === t.key ? " plans-tab--active" : ""}`}
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="plans-tab-panel">
        {tab === "budgets" && <BudgetsTab />}
        {tab === "savings" && <SavingsTab />}
        {tab === "recurring" && <RecurringTab />}
      </div>
    </div>
  );
}
