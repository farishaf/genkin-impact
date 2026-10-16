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

interface TxnActionsProps {
  selectedTxn: SelectedTxn;
  onEdit: () => void;
  onRefund: () => void;
  onInstallments: () => void;
  onDelete: () => void;
  className?: string;
}

/** Edit / refund / split / delete for one transaction. Shared by the side panel and the inline row on mobile. */
export function TxnActions({ selectedTxn, onEdit, onRefund, onInstallments, onDelete, className = "" }: TxnActionsProps) {
  const canRefund = selectedTxn.type !== "transfer";
  const canSplit = canRefund && selectedTxn.installment_plan_id === null;
  return (
    <div className={`report-action-row ${className}`.trim()}>
      <button type="button" className="report-action-btn" onClick={onEdit}>
        <EditIcon />
        <span className="report-action-btn__label">Edit</span>
      </button>
      {canRefund && (
        <button type="button" className="report-action-btn" onClick={onRefund}>
          <RefundIcon />
          <span className="report-action-btn__label">Refund</span>
        </button>
      )}
      {canSplit && (
        <button type="button" className="report-action-btn" onClick={onInstallments}>
          <InstallmentsIcon />
          <span className="report-action-btn__label">Split</span>
        </button>
      )}
      <button type="button" className="report-action-btn report-action-btn--danger" onClick={onDelete}>
        <DeleteIcon />
        <span className="report-action-btn__label">Delete</span>
      </button>
    </div>
  );
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
  // A breakdown that mixes salary with groceries answers nothing. Show spending unless the
  // list is filtered to income, in which case show where the money came from.
  const reportType = filters.type === "income" ? "income" : "expense";
  // Transfers move money between your own accounts; there's nothing to break down.
  const isTransferView = filters.type === "transfer";

  const { data, isLoading, isError } = useQuery({
    enabled: !isTransferView,
    queryKey: ["transactions", "report", groupBy, reportType, filters],
    queryFn: () => {
      const params = new URLSearchParams({ group_by: groupBy, type: reportType });
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
      <div className="right-head">
        <span className="eyebrow eyebrow--accent">{reportType === "income" ? "Income" : "Spending"} breakdown</span>
        <h2 className="right-title">{reportType === "income" ? "Where it came from" : "Where it went"}</h2>
      </div>

      <div className="seg-toggle seg-toggle--fill" role="group" aria-label="Group by">
        {GROUP_BY_OPTIONS.map((opt) => (
          <button key={opt.value} type="button" data-active={groupBy === opt.value} onClick={() => setGroupBy(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>

      {isTransferView && <p className="muted">Transfers just move money between your accounts — no breakdown to show.</p>}
      {isError && <p className="field-error">Failed to load report.</p>}
      {!isTransferView && isLoading && <p className="muted">Loading…</p>}
      {!isTransferView && !isLoading && !isError && groups.length === 0 && <p className="muted">Nothing in this range yet.</p>}

      <ReportBarChart
        groups={groups}
        maxMinor={maxMinor}
        currencyCode={mainCurrencyCode}
        clickable={clickable}
        onSelect={(id) => onSelectGroup(groupBy as "category" | "tag" | "member", id)}
      />

      {data?.outlier && (
        <div className="outlier-card">
          <span className="eyebrow">Biggest single entry</span>
          <span className="outlier-card__value">
            <span>{data.outlier.label}</span>
            <span className="num">{formatAmount(data.outlier.amount_minor, data.outlier.currency_code)} {data.outlier.currency_code}</span>
          </span>
        </div>
      )}

      {selectedTxn && (
        <div className="right-selected">
          <span className="eyebrow">Selected entry</span>
          <TxnActions
            selectedTxn={selectedTxn}
            onEdit={onEditSelected}
            onRefund={onRefundSelected}
            onInstallments={onInstallmentsSelected}
            onDelete={onDeleteSelected}
          />
        </div>
      )}
    </>
  );
}
