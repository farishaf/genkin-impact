import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { minorToInputValue } from "../lib/formatAmount";

interface Account {
  id: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
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
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

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
      const shared = {
        amount,
        occurred_at: new Date().toISOString(),
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
      <label className="field">
        <span>Type</span>
        <select disabled={isEditing} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
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
              {a.name}
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
                {a.name}
              </option>
            ))}
          </select>
        </label>
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
      <label className="field">
        <span>Amount</span>
        <input
          required
          disabled={isEditing && type === "transfer"}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </label>
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </label>
      {!isEditing && (
        <label className="field">
          <span>Receipt</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
        </label>
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
      <button className="btn-primary" type="submit" disabled={submitTxn.isPending}>
        {submitTxn.isPending ? "Saving…" : isEditing ? "Save changes" : "Save transaction"}
      </button>
    </form>
  );
}
