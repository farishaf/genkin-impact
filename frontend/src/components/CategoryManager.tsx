import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { EditIcon, DeleteIcon } from "./TxnIcons";
import { Button } from "./Button";

interface Category {
  id: string;
  name: string;
  emoji: string | null;
  kind: "expense" | "income";
  is_system: boolean;
}

export function CategoryManager() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newExpenseName, setNewExpenseName] = useState("");
  const [newExpenseEmoji, setNewExpenseEmoji] = useState("");
  const [newIncomeName, setNewIncomeName] = useState("");
  const [newIncomeEmoji, setNewIncomeEmoji] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ categories: Category[] }>("/categories").then((r) => r.categories),
  });

  const createCategory = useMutation({
    mutationFn: (body: { name: string; emoji?: string; kind: "expense" | "income" }) => api.post("/categories", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setNewExpenseName("");
      setNewExpenseEmoji("");
      setNewIncomeName("");
      setNewIncomeEmoji("");
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const renameCategory = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`/categories/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setEditingId(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.del(`/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  function renderSection(kind: "expense" | "income", label: string) {
    const items = (categories ?? []).filter((c) => c.kind === kind);
    return (
      <div className="category-manager__section">
        <h3>{label}</h3>
        {items.map((c) => (
          <div className="category-manager__row" key={c.id}>
            {editingId === c.id ? (
              <>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => renameCategory.mutate({ id: c.id, name: editName })}
                  disabled={renameCategory.isPending}
                >
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span style={{ flex: 1 }}>
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Edit ${c.name}`}
                  onClick={() => {
                    setEditingId(c.id);
                    setEditName(c.name);
                  }}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  aria-label={`Delete ${c.name}`}
                  disabled={c.is_system || deleteCategory.isPending}
                  title={c.is_system ? "Built-in categories can't be deleted" : undefined}
                  onClick={() => {
                    if (confirm(`Delete category "${c.name}"?`)) deleteCategory.mutate(c.id);
                  }}
                >
                  <DeleteIcon />
                </button>
              </>
            )}
          </div>
        ))}
        <form
          className="category-manager__add"
          onSubmit={(e) => {
            e.preventDefault();
            const name = kind === "expense" ? newExpenseName : newIncomeName;
            const emoji = kind === "expense" ? newExpenseEmoji : newIncomeEmoji;
            if (!name.trim()) return;
            createCategory.mutate({ name: name.trim(), emoji: emoji.trim() || undefined, kind });
          }}
        >
          <input
            name="emoji"
            placeholder="🏷"
            value={kind === "expense" ? newExpenseEmoji : newIncomeEmoji}
            onChange={(e) => (kind === "expense" ? setNewExpenseEmoji(e.target.value) : setNewIncomeEmoji(e.target.value))}
          />
          <input
            placeholder={`New ${label.toLowerCase().slice(0, -1)} category`}
            value={kind === "expense" ? newExpenseName : newIncomeName}
            onChange={(e) => (kind === "expense" ? setNewExpenseName(e.target.value) : setNewIncomeName(e.target.value))}
          />
          <Button variant="outline" size="sm" type="submit" disabled={createCategory.isPending}>
            + Add
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div>
      {error && <p className="field-error">{error}</p>}
      {renderSection("expense", "Expenses")}
      {renderSection("income", "Income")}
    </div>
  );
}
