import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatAmount } from "../lib/formatAmount";
import { ReportBarChart } from "./ReportBarChart";
import { EditIcon, RefundIcon, InstallmentsIcon, DeleteIcon } from "./TxnIcons";

type GroupBy = "category" | "tag" | "member" | "account";
const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "category", label: "Category" },
  { value: "tag", label: "Tag" },
  { value: "member", label: "Member" },
  { value: "account", label: "Account" },
];

interface ReportGroup {
  id: string;
  label: string;
  total_minor: string;
  count: number;
}
interface ReportOutlier {
  id: string;
  label: string;
  amount_minor: string;
  currency_code: string;
  occurred_at: string;
}
export interface ReportFilters {
  type?: string;
  member_id?: string;
  tag_id?: string;
  category_id?: string;
  from?: string;
  to?: string;
}
export interface SelectedTxn {
  id: string;
  type: "expense" | "income" | "transfer";
  installment_plan_id: string | null;
}

export function TransactionsReportPanel({
  filters,
  mainCurrencyCode,
  onSelectGroup,
  selectedTxn,
  onEditSelected,
  onRefundSelected,
  onInstallmentsSelected,
  onDeleteSelected,
}: {
  filters: ReportFilters;
  mainCurrencyCode: string;
  onSelectGroup: (dimension: "category" | "tag" | "member", id: string) => void;
  selectedTxn: SelectedTxn | null;
  onEditSelected: () => void;
  onRefundSelected: () => void;
  onInstallmentsSelected: () => void;
  onDeleteSelected: () => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("category");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["transactions", "report", groupBy, filters],
    queryFn: () => {
      const params = new URLSearchParams({ group_by: groupBy });
      if (filters.type === "expense" || filters.type === "income") params.set("type", filters.type);
      if (filters.member_id) params.set("member_id", filters.member_id);
      if (filters.tag_id) params.set("tag_id", filters.tag_id);
      if (filters.category_id) params.set("category_id", filters.category_id);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      return api.get<{ groups: ReportGroup[]; outlier: ReportOutlier | null }>(`/transactions/report?${params.toString()}`);
    },
  });

  const groups = data?.groups ?? [];
  const maxMinor = Math.max(1, ...groups.map((g) => Number(g.total_minor)));
  const clickable = groupBy !== "account";

  return (
    <>
      <div className="right-title">Report</div>

      <div className="row-toggle">
        <span className="row-toggle__label">Group By</span>
        <div className="seg-toggle" role="group" aria-label="Group by">
          {GROUP_BY_OPTIONS.map((opt) => (
            <button key={opt.value} type="button" data-active={groupBy === opt.value} onClick={() => setGroupBy(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isError && <p className="field-error">Failed to load report.</p>}
      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && !isError && groups.length === 0 && <p className="muted">No transactions in range.</p>}

      <ReportBarChart
        groups={groups}
        maxMinor={maxMinor}
        currencyCode={mainCurrencyCode}
        clickable={clickable}
        onSelect={(id) => onSelectGroup(groupBy as "category" | "tag" | "member", id)}
      />

      {data?.outlier && (
        <div className="outlier-card">
          <span className="outlier-card__label">Largest transaction</span>
          <span className="outlier-card__value">
            {data.outlier.label} — {formatAmount(data.outlier.amount_minor, data.outlier.currency_code)} {data.outlier.currency_code}
          </span>
        </div>
      )}

      {selectedTxn && (
        <div className="action-grid" style={{ marginTop: "var(--space-lg)" }}>
          <button type="button" className="action-card" onClick={onEditSelected}>
            <span className="action-card__icon">
              <EditIcon />
            </span>
            <span className="action-card__label">Edit</span>
          </button>
          {selectedTxn.type !== "transfer" && (
            <button type="button" className="action-card" onClick={onRefundSelected}>
              <span className="action-card__icon">
                <RefundIcon />
              </span>
              <span className="action-card__label">Refund</span>
            </button>
          )}
          {selectedTxn.type !== "transfer" && selectedTxn.installment_plan_id === null && (
            <button type="button" className="action-card" onClick={onInstallmentsSelected}>
              <span className="action-card__icon">
                <InstallmentsIcon />
              </span>
              <span className="action-card__label">Pay by Installments</span>
            </button>
          )}
          <button type="button" className="action-card" onClick={onDeleteSelected}>
            <span className="action-card__icon">
              <DeleteIcon />
            </span>
            <span className="action-card__label">Delete</span>
          </button>
        </div>
      )}
    </>
  );
}
