import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { decimalDigits, minorToInputValue } from "../lib/formatAmount";
import { isValidKey, todayKey } from "../lib/planner";
import { groupByCategory, type ReceiptLine } from "../lib/receiptLines";
import { ReceiptItems } from "./ReceiptItems";
import { DatePicker } from "./DatePicker";

/** What /receipts/scan reads off a photo. Amounts are in the receipt's currency, major units. */
interface ReceiptScan {
  store: string;
  date: string;
  currency: string;
  total: number | null;
  items: { name: string; qty: number; unit_price: number; category_id?: string }[];
}
// The attachments endpoint takes fewer types than the scanner (no HEIC), so only these ride along.
const ATTACHABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

interface Account {
  id: string;
  name: string;
  currency_code: string;
}
interface Category {
  id: string;
  name: string;
  emoji?: string | null;
  kind: "expense" | "income";
}
interface Member {
  id: string;
  name: string;
}
interface Tag {
  id: string;
  name: string;
}

export interface EditingTxn {
  id: string;
  type: "expense" | "income" | "transfer";
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  member_id: string | null;
  amount: string;
  currency_code: string;
  note: string | null;
  tags: { id: string; name: string }[];
}

export function AddTransactionForm({ editing, onDone }: { editing?: EditingTxn | null; onDone: () => void }) {
  const isEditing = !!editing;

  const { data: accounts, isError: isAccountsError } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });

  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<{ members: Member[] }>("/members").then((r) => r.members),
  });

  const { data: tags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.get<{ tags: Tag[] }>("/tags").then((r) => r.tags),
  });

  const [type, setType] = useState<"expense" | "income" | "transfer">(editing?.type ?? "expense");

  const { data: categories, isError: isCategoriesError } = useQuery({
    queryKey: ["categories", type],
    queryFn: () => api.get<{ categories: Category[] }>(`/categories?kind=${type}`).then((r) => r.categories),
    enabled: type !== "transfer",
  });

  const [accountId, setAccountId] = useState(editing?.account_id ?? "");
  const [toAccountId, setToAccountId] = useState(editing?.to_account_id ?? "");
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? "");
  const [memberId, setMemberId] = useState(editing?.member_id ?? "");
  const [tagIds, setTagIds] = useState<string[]>(editing?.tags.map((t) => t.id) ?? []);
  const [amount, setAmount] = useState(editing ? minorToInputValue(editing.amount, editing.currency_code) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  // Only set by a scan: the receipt's date. Empty means "now", as before.
  const [date, setDate] = useState("");
  const [scanCurrency, setScanCurrency] = useState("");
  // Set by a scan that found item lines: the form then logs one expense per category instead of one amount.
  const [lines, setLines] = useState<ReceiptLine[] | null>(null);
  const [store, setStore] = useState("");
  const [printedTotal, setPrintedTotal] = useState<number | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  // Preview of the photo that will be saved with the transaction (scanned or picked by hand).
  const [preview, setPreview] = useState<string | null>(null);
  // ponytail: the last preview URL is not revoked on unmount; one small blob per open form.
  function pickReceipt(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file?.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setReceiptFile(file);
  }
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  // The model fills the form; nothing is saved until "Save transaction", so every field stays editable.
  const scan = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.postForm<{ scan: ReceiptScan }>("/receipts/scan", fd).then((r) => r.scan);
    },
    onSuccess: (s) => {
      const match = s.currency ? (accounts ?? []).find((a) => a.currency_code === s.currency) : undefined;
      if (!accountId && match) setAccountId(match.id);
      setDate(isValidKey(s.date) ? s.date : todayKey());
      setScanCurrency(s.currency);

      if (s.items.length) {
        const fallback = categoryId || categories?.[0]?.id || "";
        setLines(s.items.map((it) => ({ id: crypto.randomUUID(), name: it.name, qty: String(it.qty), price: String(it.unit_price), category_id: it.category_id ?? fallback })));
        setStore(s.store);
        setPrintedTotal(s.total);
        return;
      }
      // No item lines read: fall back to one amount from the printed total.
      const currency = (accounts ?? []).find((a) => a.id === (accountId || match?.id))?.currency_code ?? s.currency;
      if (s.total) setAmount(currency ? s.total.toFixed(decimalDigits(currency)) : String(s.total));
      if (s.store) setNote(s.store);
    },
  });

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  const selectedCurrencyCode = editing?.currency_code ?? (accounts ?? []).find((a) => a.id === accountId)?.currency_code;

  const lineCurrency = selectedCurrencyCode || scanCurrency || "USD";
  const lineDigits = decimalDigits(lineCurrency);
  const groups = lines ? groupByCategory(lines, lineDigits) : [];

  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setCategoryId("");
  }

  const submitTxn = useMutation({
    mutationFn: () => {
      if (editing) {
        const body: Record<string, unknown> = {
          note,
          member_id: memberId || undefined,
          tag_ids: tagIds,
        };
        if (type !== "transfer") {
          body.amount = amount;
          body.category_id = categoryId;
        }
        return api.patch(`/transactions/${editing.id}`, body);
      }
      // A backdated receipt lands at local noon so timezone shifts can't move it to the next or previous day.
      const occurred_at = (date && date !== todayKey() ? new Date(`${date}T12:00:00`) : new Date()).toISOString();
      if (lines) {
        // One expense per category, saved together, so category budgets and reports count each part.
        const expenses = groups.map(([category_id, g]) => ({
          category_id,
          amount: (g.minor / 10 ** lineDigits).toFixed(lineDigits),
          note: `${store ? `${store}: ` : ""}${g.lines.map((l) => `${l.name || "Item"}${parseFloat(l.qty) !== 1 ? ` ×${l.qty}` : ""}`).join(", ")}`.slice(0, 500),
        }));
        return api
          .post<{ transactions: { id: string }[] }>("/transactions/receipt", {
            account_id: accountId,
            occurred_at,
            member_id: memberId || undefined,
            tag_ids: tagIds.length > 0 ? tagIds : undefined,
            expenses,
          })
          .then(async (result) => {
            // Every expense from this receipt keeps the photo, so each one shows it in the transaction list.
            if (receiptFile) {
              await Promise.all(
                result.transactions.map((t) => {
                  const fd = new FormData();
                  fd.append("file", receiptFile);
                  return api.postForm(`/transactions/${t.id}/attachments`, fd);
                })
              );
            }
            return result;
          });
      }
      const shared = {
        amount,
        occurred_at,
        note: note || undefined,
        member_id: memberId || undefined,
        tag_ids: tagIds.length > 0 ? tagIds : undefined,
      };
      const body =
        type === "transfer"
          ? { type, account_id: accountId, to_account_id: toAccountId, ...shared }
          : { type, account_id: accountId, category_id: categoryId, ...shared };
      return api.post<{ transaction: { id: string } }>("/transactions", body).then(async (result) => {
        if (receiptFile) {
          const fd = new FormData();
          fd.append("file", receiptFile);
          await api.postForm(`/transactions/${result.transaction.id}/attachments`, fd);
        }
        return result;
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["mainichi-money"] });
      onDone();
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await submitTxn.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form className="txn-form" onSubmit={onSubmit}>
      {!isEditing && type === "expense" && (
        <div className="field">
          <button type="button" className="btn-outline" onClick={() => scanInput.current?.click()} disabled={scan.isPending}>
            {scan.isPending ? "Reading receipt…" : "Scan receipt"}
          </button>
          <input
            ref={scanInput}
            type="file"
            // Listing types (not image/*) makes iPhones hand over a JPEG instead of HEIC, which the reader can't open.
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // so picking the same photo again re-scans it
              if (!file) return;
              if (ATTACHABLE.has(file.type)) pickReceipt(file); // the photo is also attached to the transaction
              scan.mutate(file);
            }}
          />
          <span className="muted-inline" aria-live="polite">
            {scan.isPending
              ? "This can take a minute."
              : scan.isSuccess
                ? "Filled from the photo. Check the items before saving."
                : "A photo fills in the amount, category, note and date."}
          </span>
          {scan.error && <p className="field-error">{scan.error.message}</p>}
        </div>
      )}
      <label className="field">
        <span>Type</span>
        <select disabled={isEditing || !!lines} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label className="field">
        <span>From account</span>
        <select required disabled={isEditing} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="" disabled>
            Select an account
          </option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency_code})
            </option>
          ))}
        </select>
      </label>
      {isAccountsError && <p className="field-error">Failed to load accounts. Try refreshing.</p>}
      {type === "transfer" ? (
        <label className="field">
          <span>To account</span>
          <select required disabled={isEditing} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="" disabled>
              Select an account
            </option>
            {(accounts ?? []).filter((a) => a.id !== accountId).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency_code})
              </option>
            ))}
          </select>
        </label>
      ) : lines ? (
        <>
          <ReceiptItems
            store={store}
            onStore={setStore}
            date={date || todayKey()}
            lines={lines}
            onLines={setLines}
            categories={categories ?? []}
            currency={lineCurrency}
            digits={lineDigits}
            printedTotal={printedTotal}
          />
          <button type="button" className="btn--ghost" onClick={() => setLines(null)}>
            Enter one amount instead
          </button>
        </>
      ) : (
        <label className="field">
          <span>Category</span>
          <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled>
              Select a category
            </option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {isCategoriesError && <p className="field-error">Failed to load categories. Try refreshing.</p>}
        </label>
      )}
      {!lines && (
        <label className="field">
          <span>Amount{selectedCurrencyCode && <span className="field__badge">{selectedCurrencyCode}</span>}</span>
          <input
            required
            disabled={isEditing && type === "transfer"}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>
      )}
      {scanCurrency && selectedCurrencyCode && scanCurrency !== selectedCurrencyCode && (
        <p className="field-error">The receipt reads {scanCurrency}, but this account is in {selectedCurrencyCode}.</p>
      )}
      {date && (
        <label className="field">
          <span>Date</span>
          <DatePicker required value={date} max={todayKey()} onChange={setDate} />
        </label>
      )}
      {!lines && (
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </label>
      )}
      {!isEditing && (
        <div className="field">
          <span>Receipt</span>
          {receiptFile ? (
            <div className="receipt-attach">
              {preview ? <img src={preview} alt="Receipt photo to be saved" /> : <span className="receipt-attach__doc">PDF</span>}
              <span className="receipt-attach__name">
                {receiptFile.name}
                <small>Saved with the transaction</small>
              </span>
              <button type="button" className="btn--ghost" onClick={() => receiptInput.current?.click()}>
                Replace
              </button>
              <button type="button" className="btn--ghost-danger" onClick={() => pickReceipt(null)}>
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className="btn-outline" onClick={() => receiptInput.current?.click()}>
              Attach photo or PDF
            </button>
          )}
          <input
            ref={receiptInput}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) pickReceipt(file);
            }}
          />
        </div>
      )}
      <label className="field">
        <span>Member</span>
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Unassigned</option>
          {(members ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {(tags ?? []).length > 0 && (
        <div className="field">
          <span>Tags</span>
          <div className="tag-chips">
            {(tags ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tag-chip${tagIds.includes(t.id) ? " tag-chip--active" : ""}`}
                onClick={() => toggleTag(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={submitTxn.isPending || (!!lines && groups.length === 0)}>
        {submitTxn.isPending
          ? "Saving…"
          : isEditing
            ? "Save changes"
            : lines
              ? `Save ${groups.length} expense${groups.length === 1 ? "" : "s"}`
              : "Save transaction"}
      </button>
    </form>
  );
}
