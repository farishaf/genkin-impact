import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { api, ApiError, API_URL } from "../lib/api";
import { formatMoney, minorToInputValue } from "../lib/formatAmount";
import { hueStyle } from "../lib/categoryHue";
import {
  AddTransactionForm,
  type EditingTxn,
} from "../components/AddTransactionForm";
import {
  TransactionsReportPanel,
  TxnActions,
} from "../components/TransactionsReportPanel";
import { SummaryHero } from "../components/SummaryHero";
import {
  ChevronIcon,
  PaperclipIcon,
  PlusIcon,
  SlidersIcon,
} from "../components/TxnIcons";
import { Modal } from "../components/Modal";
import { CategoryManager } from "../components/CategoryManager";
import { Button } from "../components/Button";
import { MOBILE_QUERY, useMediaQuery } from "../hooks/useMediaQuery";

gsap.registerPlugin(useGSAP);

interface Summary {
  income_minor: string;
  expenditure_minor: string;
  balance_minor: string;
  count: number;
  main_currency_code: string;
}

interface TxnItem {
  id: string;
  type: "expense" | "income" | "transfer";
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  member_id: string | null;
  amount: string;
  currency_code: string;
  occurred_at: string;
  note: string | null;
  category_name: string | null;
  account_name: string;
  member_name: string | null;
  tags: { id: string; name: string }[];
  refund_of_id: string | null;
  installment_plan_id: string | null;
  installment_seq: number | null;
  attachment_id: string | null;
}
interface Member {
  id: string;
  name: string;
}
interface Tag {
  id: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
}
interface FilterCriteria {
  type?: string;
  member_id?: string;
  tag_id?: string;
  category_id?: string;
  from?: string;
  to?: string;
}
interface SavedFilter {
  id: string;
  name: string;
  criteria: FilterCriteria;
}
interface TxnGroup {
  key: string;
  label: string;
  txns: TxnItem[];
  // null when the day mixes currencies — summing raw minor units across currencies would be
  // meaningless, and converting live per group here would just duplicate the summary card's
  // job. Groups with a mixed day simply render without pills.
  expenseMinor: bigint | null;
  incomeMinor: bigint | null;
  currencyCode: string | null;
}

function toDateOnly(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function quickRange(
  preset: "today" | "yesterday" | "this_week" | "last_week",
): { from: string; to: string } {
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (preset === "today") {
    const d = startOfDay(now);
    return { from: toDateOnly(d), to: toDateOnly(d) };
  }
  if (preset === "yesterday") {
    const d = startOfDay(now);
    d.setDate(d.getDate() - 1);
    return { from: toDateOnly(d), to: toDateOnly(d) };
  }
  const dow = now.getDay();
  const mondayOffset = (dow + 6) % 7;
  const thisMonday = startOfDay(now);
  thisMonday.setDate(thisMonday.getDate() - mondayOffset);
  if (preset === "this_week") {
    const sunday = new Date(thisMonday);
    sunday.setDate(sunday.getDate() + 6);
    return { from: toDateOnly(thisMonday), to: toDateOnly(sunday) };
  }
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(lastSunday.getDate() - 1);
  return { from: toDateOnly(lastMonday), to: toDateOnly(lastSunday) };
}

function dateGroupLabel(dateKey: string): string {
  const day = new Date(`${dateKey}T00:00:00`);
  const today = new Date();
  const todayKey = toDateOnly(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === todayKey) return "Today";
  if (dateKey === toDateOnly(yesterday)) return "Yesterday";
  return day.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// items arrive sorted occurred_at DESC from the backend, so Map insertion order already
// keeps groups newest-first — no extra sort needed.
function groupByDate(items: TxnItem[]): TxnGroup[] {
  const map = new Map<string, TxnItem[]>();
  for (const t of items) {
    const key = t.occurred_at.slice(0, 10);
    const existing = map.get(key);
    if (existing) existing.push(t);
    else map.set(key, [t]);
  }
  return [...map.entries()].map(([key, txns]) => {
    const currencies = new Set(txns.map((t) => t.currency_code));
    const uniform = currencies.size === 1;
    return {
      key,
      label: dateGroupLabel(key),
      txns,
      expenseMinor: uniform
        ? txns
            .filter((t) => t.type === "expense")
            .reduce((sum, t) => sum + BigInt(t.amount), 0n)
        : null,
      incomeMinor: uniform
        ? txns
            .filter((t) => t.type === "income")
            .reduce((sum, t) => sum + BigInt(t.amount), 0n)
        : null,
      currencyCode: uniform ? txns[0].currency_code : null,
    };
  });
}

export function TransactionsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingTxn, setEditingTxn] = useState<EditingTxn | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [memberFilter, setMemberFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [fromFilter, setFromFilter] = useState<string>("");
  const [toFilter, setToFilter] = useState<string>("");
  const [activeRangePreset, setActiveRangePreset] = useState<string>("");
  const [viewMode, setViewMode] = useState<"list" | "table">("list");
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // The shell's "+" links here with ?new=1 so a new entry can be started from any tab.
  // Derived rather than synced into state, so there's no effect to keep in step.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsNew = searchParams.get("new") === "1";
  const formOpen = showForm || wantsNew;

  useEffect(() => {
    if (!filterOpen || isMobile) return;
    function handlePointerDown(e: MouseEvent) {
      if (
        filterPopoverRef.current &&
        !filterPopoverRef.current.contains(e.target as Node)
      )
        setFilterOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterOpen, isMobile]);

  function applyRangePreset(
    preset: "today" | "yesterday" | "this_week" | "last_week" | "",
  ) {
    setActiveRangePreset(preset);
    if (preset === "") {
      setFromFilter("");
      setToFilter("");
      return;
    }
    const { from, to } = quickRange(preset);
    setFromFilter(from);
    setToFilter(to);
  }

  function applySavedFilter(criteria: FilterCriteria) {
    setTypeFilter(criteria.type ?? "");
    setMemberFilter(criteria.member_id ?? "");
    setTagFilter(criteria.tag_id ?? "");
    setCategoryFilter(criteria.category_id ?? "");
    setFromFilter(criteria.from ?? "");
    setToFilter(criteria.to ?? "");
    setActiveRangePreset("");
  }

  function clearAllFilters() {
    setTypeFilter("");
    setMemberFilter("");
    setTagFilter("");
    setCategoryFilter("");
    setFromFilter("");
    setToFilter("");
    setActiveRangePreset("");
  }

  const activeFilterCount = [
    typeFilter,
    memberFilter,
    tagFilter,
    categoryFilter,
    fromFilter || toFilter,
  ].filter(Boolean).length;

  const { data: savedFilters } = useQuery({
    queryKey: ["savedFilters"],
    queryFn: () =>
      api
        .get<{ saved_filters: SavedFilter[] }>("/saved-filters")
        .then((r) => r.saved_filters),
  });

  const saveFilter = useMutation({
    mutationFn: (body: { name: string; criteria: FilterCriteria }) =>
      api.post("/saved-filters", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["savedFilters"] }),
  });

  const deleteSavedFilter = useMutation({
    mutationFn: (id: string) => api.del(`/saved-filters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["savedFilters"] }),
  });

  function handleSaveCurrentFilter() {
    const name = window.prompt("Name this filter view:");
    if (!name) return;
    const criteria: FilterCriteria = {
      ...(typeFilter && { type: typeFilter }),
      ...(memberFilter && { member_id: memberFilter }),
      ...(tagFilter && { tag_id: tagFilter }),
      ...(categoryFilter && { category_id: categoryFilter }),
      ...(fromFilter && { from: fromFilter }),
      ...(toFilter && { to: toFilter }),
    };
    saveFilter.mutate({ name, criteria });
  }

  const { data: summary, isError: isSummaryError } = useQuery({
    queryKey: ["transactions", "summary", fromFilter, toFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (fromFilter) params.set("from", fromFilter);
      if (toFilter) params.set("to", toFilter);
      const qs = params.toString();
      return api
        .get<{ summary: Summary }>(`/transactions/summary${qs ? `?${qs}` : ""}`)
        .then((r) => r.summary);
    },
  });

  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: () =>
      api.get<{ members: Member[] }>("/members").then((r) => r.members),
  });
  const { data: tags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.get<{ tags: Tag[] }>("/tags").then((r) => r.tags),
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      api
        .get<{ categories: Category[] }>("/categories")
        .then((r) => r.categories),
  });

  const {
    data: items,
    isLoading,
    isError: isItemsError,
  } = useQuery({
    queryKey: [
      "transactions",
      "list",
      typeFilter,
      memberFilter,
      tagFilter,
      categoryFilter,
      fromFilter,
      toFilter,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (memberFilter) params.set("member_id", memberFilter);
      if (tagFilter) params.set("tag_id", tagFilter);
      if (categoryFilter) params.set("category_id", categoryFilter);
      if (fromFilter) params.set("from", fromFilter);
      if (toFilter) params.set("to", toFilter);
      const qs = params.toString();
      return api
        .get<{ items: TxnItem[] }>(`/transactions${qs ? `?${qs}` : ""}`)
        .then((r) => r.items);
    },
  });

  const deleteTxn = useMutation({
    mutationFn: (id: string) => api.del(`/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setSelectedTxnId(null);
    },
  });

  const [openAction, setOpenAction] = useState<{
    id: string;
    kind: "refund" | "installments";
  } | null>(null);
  function toggleAction(id: string, kind: "refund" | "installments") {
    setOpenAction((cur) =>
      cur?.id === id && cur.kind === kind ? null : { id, kind },
    );
  }

  const refundTxn = useMutation({
    mutationFn: ({
      id,
      amount,
      note,
    }: {
      id: string;
      amount: string;
      note: string;
    }) =>
      api.post(`/transactions/${id}/refund`, {
        amount,
        note: note || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setOpenAction(null);
    },
  });

  const installmentsTxn = useMutation({
    mutationFn: (body: {
      id: string;
      installment_count: number;
      interval_unit: "month" | "week";
      fee_amount: string;
      first_due_date: string;
    }) =>
      api.post(`/transactions/${body.id}/installments`, {
        installment_count: body.installment_count,
        interval_unit: body.interval_unit,
        fee_amount: body.fee_amount || undefined,
        first_due_date: body.first_due_date,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setOpenAction(null);
    },
  });

  const { contextSafe } = useGSAP({ scope: listRef });

  useGSAP(
    () => {
      gsap.from(".chip-attachment", {
        opacity: 0,
        scale: 0.85,
        duration: 0.2,
        ease: "power2.out",
        stagger: 0.03,
      });
    },
    { scope: listRef, dependencies: [items] },
  );

  useGSAP(
    () => {
      if (!filterOpen) return;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      gsap.from(".filter-popover", {
        autoAlpha: 0,
        y: reduced ? 0 : -6,
        duration: reduced ? 0.15 : 0.18,
        ease: "power2.out",
      });
    },
    { scope: filterPopoverRef, dependencies: [filterOpen] },
  );

  const handleDelete = contextSafe((t: TxnItem) => {
    if (
      !confirm(
        `Delete this ${t.type === "expense" ? "-" : "+"}${formatMoney(t.amount, t.currency_code)} ${t.category_name ?? "transfer"}?`,
      )
    )
      return;
    const el = rowRefs.current[t.id];
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!el || reduced) {
      deleteTxn.mutate(t.id);
      return;
    }
    gsap.to(el, {
      opacity: 0,
      x: 8,
      duration: 0.2,
      ease: "power2.out",
      onComplete: () => deleteTxn.mutate(t.id),
    });
  });

  function openCreate() {
    setEditingTxn(null);
    setShowForm(true);
  }
  function openEdit(t: TxnItem) {
    setEditingTxn({
      id: t.id,
      type: t.type,
      account_id: t.account_id,
      to_account_id: t.to_account_id,
      category_id: t.category_id,
      member_id: t.member_id,
      amount: t.amount,
      currency_code: t.currency_code,
      note: t.note,
      tags: t.tags,
    });
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingTxn(null);
    if (wantsNew) {
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }

  const rangeLabel =
    activeRangePreset === "today"
      ? "Today"
      : activeRangePreset === "yesterday"
        ? "Yesterday"
        : activeRangePreset === "this_week"
          ? "This week"
          : activeRangePreset === "last_week"
            ? "Last week"
            : fromFilter || toFilter
              ? "Custom range"
              : "All time";

  const selectedTxn = items?.find((t) => t.id === selectedTxnId) ?? null;
  const groups = groupByDate(items ?? []);

  function renderRow(t: TxnItem) {
    return (
      <Fragment key={t.id}>
        <button
          type="button"
          className="txn-row"
          data-selected={selectedTxnId === t.id}
          ref={(el) => {
            rowRefs.current[t.id] = el;
          }}
          onClick={() =>
            setSelectedTxnId((cur) => (cur === t.id ? null : t.id))
          }
        >
          <span
            className="cat-badge"
            data-kind={t.type}
            style={hueStyle(t.category_name ?? t.account_name)}
          >
            {(t.category_name ?? t.account_name).charAt(0).toUpperCase()}
          </span>
          <div className="txn-row__body">
            <div className="txn-row__top">
              <span className="txn-row__cat">
                {t.type === "transfer"
                  ? "Transfer"
                  : (t.category_name ?? "Refund")}
              </span>
              <span className="txn-row__time">
                {new Date(t.occurred_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {t.note && <div className="txn-row__note">{t.note}</div>}
            <div className="chip-row">
              <span className="chip-acct">{t.account_name}</span>
              {t.member_name && (
                <span className="chip-tag">{t.member_name}</span>
              )}
              {t.tags.map((tag) => (
                <span key={tag.id} className="chip-tag">
                  {tag.name}
                </span>
              ))}
              {t.refund_of_id && <span className="chip-tag">Refund</span>}
              {t.installment_plan_id && t.installment_seq === null && (
                <span className="chip-tag">Installment plan</span>
              )}
              {t.installment_seq !== null && (
                <span className="chip-tag">
                  Installment #{t.installment_seq}
                </span>
              )}
              {t.attachment_id && (
                <a
                  className="chip-tag chip-attachment"
                  href={`${API_URL}/attachments/${t.attachment_id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <PaperclipIcon /> Receipt
                </a>
              )}
            </div>
          </div>
          <div className="txn-row__end">
            <span
              className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}
            >
              {t.type === "expense" ? "-" : "+"}
              {formatMoney(t.amount, t.currency_code)}
            </span>
            <ChevronIcon />
          </div>
        </button>

        {selectedTxnId === t.id && (
          <TxnActions
            className="report-action-row--inline"
            selectedTxn={t}
            onEdit={() => openEdit(t)}
            onRefund={() => toggleAction(t.id, "refund")}
            onInstallments={() => toggleAction(t.id, "installments")}
            onDelete={() => handleDelete(t)}
          />
        )}

        {openAction?.id === t.id && openAction.kind === "refund" && (
          <div className="inline-action">
            <form
              className="contribute-form"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                refundTxn.mutate({
                  id: t.id,
                  amount: String(fd.get("amount") ?? ""),
                  note: String(fd.get("note") ?? ""),
                });
              }}
            >
              <input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={minorToInputValue(t.amount, t.currency_code)}
              />
              <input name="note" placeholder="Note (optional)" />
              <button
                className="btn-primary btn-outline--sm"
                type="submit"
                disabled={refundTxn.isPending}
              >
                {refundTxn.isPending ? "Refunding…" : "Refund"}
              </button>
              <button
                className="btn-outline btn-outline--sm"
                type="button"
                onClick={() => setOpenAction(null)}
              >
                Cancel
              </button>
            </form>
            {refundTxn.isError && (
              <p className="field-error">
                {refundTxn.error instanceof ApiError
                  ? refundTxn.error.message
                  : "Something went wrong."}
              </p>
            )}
          </div>
        )}

        {openAction?.id === t.id && openAction.kind === "installments" && (
          <div className="inline-action">
            <form
              className="contribute-form"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                installmentsTxn.mutate({
                  id: t.id,
                  installment_count: Number(fd.get("installment_count")),
                  interval_unit:
                    fd.get("interval_unit") === "week" ? "week" : "month",
                  fee_amount: String(fd.get("fee_amount") ?? ""),
                  first_due_date: String(fd.get("first_due_date")),
                });
              }}
            >
              <input
                name="installment_count"
                type="number"
                min={2}
                max={60}
                defaultValue={3}
                required
              />
              <select name="interval_unit" defaultValue="month">
                <option value="month">Monthly</option>
                <option value="week">Weekly</option>
              </select>
              <input
                name="fee_amount"
                inputMode="decimal"
                placeholder="Fee (optional)"
              />
              <input
                name="first_due_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
              <button
                className="btn-primary btn-outline--sm"
                type="submit"
                disabled={installmentsTxn.isPending}
              >
                {installmentsTxn.isPending ? "Splitting…" : "Split"}
              </button>
              <button
                className="btn-outline btn-outline--sm"
                type="button"
                onClick={() => setOpenAction(null)}
              >
                Cancel
              </button>
            </form>
            {installmentsTxn.isError && (
              <p className="field-error">
                {installmentsTxn.error instanceof ApiError
                  ? installmentsTxn.error.message
                  : "Something went wrong."}
              </p>
            )}
          </div>
        )}
      </Fragment>
    );
  }

  const filterContent = (
    <>
                <div className="filter-popover__section">
                  <span className="filter-popover__label">Type</span>
                  <span className="select-wrap">
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                    >
                      <option value="">All types</option>
                      <option value="expense">Expenses</option>
                      <option value="income">Income</option>
                      <option value="transfer">Transfers</option>
                    </select>
                    <ChevronIcon />
                  </span>
                </div>
                <div className="filter-popover__section">
                  <span className="filter-popover__label">Member</span>
                  <span className="select-wrap">
                    <select
                      value={memberFilter}
                      onChange={(e) => setMemberFilter(e.target.value)}
                    >
                      <option value="">All members</option>
                      {(members ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <ChevronIcon />
                  </span>
                </div>
                <div className="filter-popover__section">
                  <span className="filter-popover__label">Tag</span>
                  <span className="select-wrap">
                    <select
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value)}
                    >
                      <option value="">All tags</option>
                      {(tags ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <ChevronIcon />
                  </span>
                </div>
                <div className="filter-popover__section">
                  <div className="filter-popover__section-head">
                    <span className="filter-popover__label">Category</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCategoryManagerOpen(true)}
                    >
                      Manage
                    </Button>
                  </div>
                  <span className="select-wrap">
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {(categories ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <ChevronIcon />
                  </span>
                </div>
                <div className="filter-popover__section">
                  <span className="filter-popover__label">Date range</span>
                  <div className="filter-popover__row">
                    {(
                      [
                        "",
                        "today",
                        "yesterday",
                        "this_week",
                        "last_week",
                      ] as const
                    ).map((preset) => (
                      <button
                        key={preset || "all"}
                        type="button"
                        className={`tag-chip${activeRangePreset === preset ? " tag-chip--active" : ""}`}
                        onClick={() => applyRangePreset(preset)}
                      >
                        {preset === ""
                          ? "All time"
                          : preset === "today"
                            ? "Today"
                            : preset === "yesterday"
                              ? "Yesterday"
                              : preset === "this_week"
                                ? "This week"
                                : "Last week"}
                      </button>
                    ))}
                  </div>
                </div>

                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    onClick={clearAllFilters}
                  >
                    Clear filters
                  </Button>
                )}

                <div className="filter-popover__foot">
                  <span className="filter-popover__label">Saved filters</span>
                  <div className="filter-popover__row">
                    {(savedFilters ?? []).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="tag-chip"
                        onClick={() => applySavedFilter(f.criteria)}
                      >
                        {f.name}
                        <span
                          className="tag-chip__remove"
                          role="button"
                          aria-label={`Delete saved filter ${f.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete saved filter "${f.name}"?`))
                              deleteSavedFilter.mutate(f.id);
                          }}
                        >
                          ×
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="tag-chip"
                      onClick={handleSaveCurrentFilter}
                      disabled={saveFilter.isPending}
                    >
                      + Save current filter
                    </button>
                  </div>
                </div>
    </>
  );

  const breakdownPanel = (
    <TransactionsReportPanel
      filters={{
        type: typeFilter || undefined,
        member_id: memberFilter || undefined,
        tag_id: tagFilter || undefined,
        category_id: categoryFilter || undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
      }}
      mainCurrencyCode={summary?.main_currency_code ?? "USD"}
      onSelectGroup={(dimension, id) => {
        if (dimension === "category") setCategoryFilter(id);
        else if (dimension === "tag") setTagFilter(id);
        else setMemberFilter(id);
        setBreakdownOpen(false);
      }}
      selectedTxn={selectedTxn}
      onEditSelected={() => selectedTxn && openEdit(selectedTxn)}
      onRefundSelected={() => selectedTxn && toggleAction(selectedTxn.id, "refund")}
      onInstallmentsSelected={() => selectedTxn && toggleAction(selectedTxn.id, "installments")}
      onDeleteSelected={() => selectedTxn && handleDelete(selectedTxn)}
    />
  );

  return (
    <div className="txn-page">
      <div className="txn-page__content">
        <header className="page-head">
          <div className="page-head__titles page-head__titles--wide">
            <span className="eyebrow eyebrow--accent">Your ledger</span>
            <div className="page-head__title-row">
              <h1>Activity</h1>
              <Button variant="outline" size="sm" className="page-head__breakdown" onClick={() => setBreakdownOpen(true)}>
                Breakdown
              </Button>
            </div>
          </div>
          <div className="page-head__actions">
          <div className="filter-popover-wrap" ref={filterPopoverRef}>
            <div className="filter-cluster">
              <button
                type="button"
                className="filter-trigger"
                data-open={filterOpen}
                data-active={activeFilterCount > 0}
                aria-expanded={filterOpen}
                aria-haspopup="true"
                onClick={() => setFilterOpen((v) => !v)}
              >
                <SlidersIcon size={16} />
                Filter
                {activeFilterCount > 0 && (
                  <span className="filter-chip--emph">{activeFilterCount}</span>
                )}
              </button>
            </div>

            {filterOpen && !isMobile && (
              <div
                className="filter-popover"
                role="dialog"
                aria-label="Filters"
              >
                {filterContent}
              </div>
            )}
          </div>
          <div className="seg-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              data-active={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
            <button
              type="button"
              data-active={viewMode === "table"}
              onClick={() => setViewMode("table")}
            >
              Table
            </button>
          </div>
          <Button variant="outline" onClick={() => setCategoryManagerOpen(true)}>
            Categories
          </Button>
          <button
            className="btn-primary page-head__new"
            type="button"
            onClick={() => (formOpen ? closeForm() : openCreate())}
          >
            <PlusIcon size={16} />
            New entry
          </button>
          </div>
        </header>

        <Modal
          open={formOpen}
          onClose={closeForm}
          title={editingTxn ? "Edit entry" : "New entry"}
        >
          <AddTransactionForm
            key={editingTxn?.id ?? "new"}
            editing={editingTxn}
            onDone={closeForm}
          />
        </Modal>

        <Modal
          open={categoryManagerOpen}
          onClose={() => setCategoryManagerOpen(false)}
          title="Categories"
        >
          <CategoryManager />
        </Modal>

        {isSummaryError && (
          <p className="field-error">Failed to load summary. Try refreshing.</p>
        )}

        {summary && <SummaryHero summary={summary} rangeLabel={rangeLabel} />}

        <div>
          {isItemsError && (
            <p className="field-error">
              Failed to load transactions. Try refreshing.
            </p>
          )}
          {isLoading && <p className="muted">Loading…</p>}

          {viewMode === "table" && (
            <div className="card txn-card txn-card--table">
              <table className="txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Member</th>
                    <th>Account</th>
                    <th>Note</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items?.map((t) => (
                    <tr key={t.id}>
                      <td>{new Date(t.occurred_at).toLocaleDateString()}</td>
                      <td>
                        {t.type === "transfer"
                          ? "Transfer"
                          : (t.category_name ?? "Refund")}
                        {t.refund_of_id && <sup title="Refund">R</sup>}
                        {t.installment_seq !== null && (
                          <sup title={`Installment #${t.installment_seq}`}>
                            #{t.installment_seq}
                          </sup>
                        )}
                      </td>
                      <td>{t.member_name ?? "—"}</td>
                      <td>{t.account_name}</td>
                      <td className="txn-table__note">{t.note ?? ""}</td>
                      <td
                        className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}
                      >
                        {t.type === "expense" ? "-" : "+"}
                        {formatMoney(t.amount, t.currency_code)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewMode === "list" && (
            <div className="txn-section" ref={listRef}>
              {groups.map((g) => (
                <div className="txn-group" key={g.key}>
                  <div className="txn-group__head">
                    <span className="txn-group__date">{g.label}</span>
                    {g.expenseMinor !== null && g.expenseMinor > 0n && (
                      <span className="txn-group__pill" data-tone="negative">
                        -
                        {formatMoney(
                          g.expenseMinor.toString(),
                          g.currencyCode!,
                        )}
                      </span>
                    )}
                    {g.incomeMinor !== null && g.incomeMinor > 0n && (
                      <span className="txn-group__pill" data-tone="positive">
                        +
                        {formatMoney(g.incomeMinor.toString(), g.currencyCode!)}
                      </span>
                    )}
                  </div>
                  <div className="card txn-card">{g.txns.map(renderRow)}</div>
                </div>
              ))}
              {items?.length === 0 && (
                <div className="empty-state">
                  <span className="eyebrow eyebrow--accent">Nothing here yet</span>
                  <p>
                    {activeFilterCount > 0
                      ? "No entries match these filters."
                      : "Log your first coffee, top-up or payday — it takes five seconds."}
                  </p>
                  {activeFilterCount > 0 ? (
                    <button className="btn-outline" type="button" onClick={clearAllFilters}>
                      Clear filters
                    </button>
                  ) : (
                    <button className="btn-primary" type="button" onClick={openCreate}>
                      <PlusIcon size={16} />
                      New entry
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isMobile && (
        <aside className="right">
          <div className="right-inner">{breakdownPanel}</div>
        </aside>
      )}

      <Modal open={filterOpen && isMobile} onClose={() => setFilterOpen(false)} title="Filters">
        <div className="filter-sheet">{filterContent}</div>
      </Modal>

      <Modal open={breakdownOpen && isMobile} onClose={() => setBreakdownOpen(false)} title="Breakdown">
        <div className="right-inner">{breakdownPanel}</div>
      </Modal>
    </div>
  );
}
