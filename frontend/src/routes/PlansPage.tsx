import { useState } from "react";
import { BudgetsTab } from "../components/BudgetsTab";
import { SavingsTab } from "../components/SavingsTab";
import { RecurringTab } from "../components/RecurringTab";

const TABS = [
  { key: "budgets", label: "Budgets" },
  { key: "savings", label: "Savings" },
  { key: "recurring", label: "Recurring" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function PlansPage() {
  const [tab, setTab] = useState<TabKey>("budgets");

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__titles">
          <span className="eyebrow eyebrow--accent">Stay ahead</span>
          <h1>Plans</h1>
        </div>
      </header>
      <div className="seg-toggle seg-toggle--lg plans-seg" role="tablist" aria-label="Plan type">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            data-active={tab === t.key}
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="plans-tab-panel" role="tabpanel">
        {tab === "budgets" && <BudgetsTab />}
        {tab === "savings" && <SavingsTab />}
        {tab === "recurring" && <RecurringTab />}
      </div>
    </div>
  );
}
