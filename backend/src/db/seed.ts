import { pool } from "./pool.js";
import { newId } from "../lib/ids.js";
import { hashPassword } from "../lib/password.js";
import { recomputeAccountBalance } from "../lib/balances.js";

// Demo data for screenshots / local demos. Idempotent: re-running wipes and rebuilds the demo user.
// Usage: npm run seed   ->   login demo@genkin.app / Demo1234!

const DEMO_EMAIL = "demo@genkin.app";
const DEMO_PASSWORD = "Demo1234!";
const MONTHS_OF_HISTORY = 5;

// Deterministic PRNG (mulberry32) so every run produces the same-looking data.
function makeRng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260101);
const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];

function daysAgo(n: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, between(0, 59), 0, 0);
  return d;
}

function monthStart(offset: number): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1, 9, 0, 0);
}

const ACCOUNTS = [
  { key: "bca", name: "BCA Checking", type: "bank", cur: "IDR", opening: 18_500_000, icon: "🏦", color: "#2563eb" },
  { key: "gopay", name: "GoPay", type: "e_wallet", cur: "IDR", opening: 850_000, icon: "📱", color: "#10b981" },
  { key: "cash", name: "Cash", type: "cash", cur: "IDR", opening: 600_000, icon: "💵", color: "#84cc16" },
  { key: "cc", name: "Mandiri Credit Card", type: "credit_card", cur: "IDR", opening: 0, icon: "💳", color: "#f97316", limit: 25_000_000, statementDay: 25 },
  { key: "wise", name: "Wise USD", type: "bank", cur: "USD", opening: 214_000, icon: "🌐", color: "#8b5cf6" },
  { key: "bibit", name: "Bibit Investments", type: "investment", cur: "IDR", opening: 42_000_000, icon: "📈", color: "#0ea5e9" },
] as const;
type AccountKey = (typeof ACCOUNTS)[number]["key"];

const EXTRA_EXPENSE_CATEGORIES = [
  { name: "Groceries", emoji: "🛒" },
  { name: "Eating Out", emoji: "🍜" },
  { name: "Transport", emoji: "🚆" },
  { name: "Rent", emoji: "🏠" },
  { name: "Utilities", emoji: "💡" },
  { name: "Entertainment", emoji: "🎬" },
  { name: "Shopping", emoji: "🛍️" },
  { name: "Coffee", emoji: "☕" },
  { name: "Subscriptions", emoji: "🔁" },
];
const EXTRA_INCOME_CATEGORIES = [{ name: "Freelance", emoji: "💻" }];

const TAGS = [
  { name: "Essential", color: "#16a34a" },
  { name: "Treat yourself", color: "#db2777" },
  { name: "Work", color: "#2563eb" },
  { name: "Weekend", color: "#f59e0b" },
];

async function wipeDemoUser(client: import("pg").PoolClient): Promise<void> {
  const res = await client.query("SELECT id FROM users WHERE email = $1", [DEMO_EMAIL]);
  if (res.rows.length === 0) return;
  const uid = res.rows[0].id as string;
  const stmts = [
    "DELETE FROM attachments WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = $1)",
    "DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = $1)",
    "UPDATE transactions SET refund_of_id = NULL, installment_plan_id = NULL WHERE user_id = $1",
    "DELETE FROM installment_plans WHERE user_id = $1",
    "DELETE FROM transactions WHERE user_id = $1",
    "DELETE FROM recurring_rules WHERE user_id = $1",
    "DELETE FROM savings_goals WHERE user_id = $1",
    "DELETE FROM budgets WHERE user_id = $1",
    "DELETE FROM saved_filters WHERE user_id = $1",
    "DELETE FROM tags WHERE user_id = $1 AND parent_id IS NOT NULL",
    "DELETE FROM tags WHERE user_id = $1",
    "DELETE FROM members WHERE user_id = $1",
    "DELETE FROM accounts WHERE user_id = $1",
    "UPDATE categories SET parent_id = NULL WHERE user_id = $1",
    "DELETE FROM categories WHERE user_id = $1",
    "DELETE FROM sessions WHERE user_id = $1",
    "DELETE FROM users WHERE id = $1",
  ];
  for (const sql of stmts) await client.query(sql, [uid]);
}

interface TxnRow {
  type: "expense" | "income" | "transfer";
  account: AccountKey;
  toAccount?: AccountKey;
  category?: string;
  member?: "me" | "partner";
  amount: number;
  toAmount?: number;
  cur: string;
  at: Date;
  note: string;
  status?: "cleared" | "pending";
  tags?: string[];
}

function buildTransactions(): TxnRow[] {
  const rows: TxnRow[] = [];

  for (let m = MONTHS_OF_HISTORY; m >= 0; m--) {
    const start = monthStart(-m);
    const isCurrent = m === 0;
    const lastDay = isCurrent ? new Date().getDate() : 28;
    const at = (day: number, hour = 10) =>
      new Date(start.getFullYear(), start.getMonth(), Math.min(day, lastDay), hour, between(0, 59));
    const inRange = (day: number) => day <= lastDay;

    // Fixed monthly items
    if (inRange(1)) {
      rows.push({ type: "income", account: "bca", category: "Salary", amount: 14_500_000 + (m <= 2 ? 1_000_000 : 0), cur: "IDR", at: at(1, 9), note: "Monthly salary", tags: ["Work"] });
      rows.push({ type: "expense", account: "bca", category: "Rent", amount: 3_800_000, cur: "IDR", at: at(2, 11), note: "Apartment rent", tags: ["Essential"] });
    }
    if (inRange(5)) {
      rows.push({ type: "expense", account: "bca", category: "Utilities", amount: between(380, 520) * 1000, cur: "IDR", at: at(5, 14), note: "Electricity & water", tags: ["Essential"] });
      rows.push({ type: "expense", account: "cc", category: "Subscriptions", amount: 186_000, cur: "IDR", at: at(6, 8), note: "Netflix & Spotify" });
    }
    if (inRange(8)) {
      rows.push({ type: "transfer", account: "bca", toAccount: "bibit", amount: 2_000_000, toAmount: 2_000_000, cur: "IDR", at: at(8, 9), note: "Monthly investing" });
    }
    if (inRange(3)) {
      rows.push({ type: "transfer", account: "bca", toAccount: "gopay", amount: 2_000_000, toAmount: 2_000_000, cur: "IDR", at: at(3, 9), note: "GoPay top up" });
      rows.push({ type: "transfer", account: "bca", toAccount: "cash", amount: 500_000, toAmount: 500_000, cur: "IDR", at: at(3, 10), note: "ATM withdrawal" });
    }
    if (inRange(16)) {
      rows.push({ type: "transfer", account: "bca", toAccount: "gopay", amount: 500_000, toAmount: 500_000, cur: "IDR", at: at(16, 9), note: "GoPay top up" });
    }
    if (inRange(15) && m % 2 === 0) {
      rows.push({ type: "income", account: "wise", category: "Freelance", amount: between(450, 900) * 100, cur: "USD", at: at(15, 16), note: "Freelance project payout", tags: ["Work"] });
    }
    if (m === 3) {
      rows.push({ type: "income", account: "bca", category: "Bonus", amount: 7_500_000, cur: "IDR", at: at(20, 10), note: "Annual performance bonus" });
    }
    if (m === 2) {
      rows.push({ type: "expense", account: "cc", category: "Travel", amount: 6_450_000, cur: "IDR", at: at(18, 13), note: "Flights to Bali", tags: ["Treat yourself"] });
      rows.push({ type: "expense", account: "cc", category: "Travel", amount: 3_200_000, cur: "IDR", at: at(19, 13), note: "Hotel — 3 nights", tags: ["Treat yourself"] });
    }

    // Variable spending, a few entries per week
    for (let day = 1; day <= lastDay; day++) {
      const dow = new Date(start.getFullYear(), start.getMonth(), day).getDay();
      const weekend = dow === 0 || dow === 6;
      if (rng() < 0.55) {
        rows.push({ type: "expense", account: pick(["gopay", "gopay", "cash"] as const), category: "Coffee", member: "me", amount: roundTo(between(28, 62) * 1000, 1000), cur: "IDR", at: at(day, 8), note: pick(["Kopi Kenangan", "Starbucks", "Fore Coffee", "Janji Jiwa"]) });
      }
      if (rng() < 0.7) {
        rows.push({ type: "expense", account: pick(["gopay", "bca", "cc"] as const), category: pick(["Eating Out", "Eating Out", "Delivery"] as const), member: rng() < 0.3 ? "partner" : "me", amount: roundTo(between(35, 160) * 1000, 1000), cur: "IDR", at: at(day, 19), note: pick(["Lunch with team", "GrabFood order", "Sushi Tei", "Warung Padang", "Ramen night", "GoFood — nasi goreng"]), tags: weekend ? ["Weekend"] : [] });
      }
      if (day % 6 === 0) {
        rows.push({ type: "expense", account: "bca", category: "Groceries", member: "partner", amount: roundTo(between(280, 720) * 1000, 1000), cur: "IDR", at: at(day, 17), note: pick(["Superindo", "Farmers Market", "Ranch Market", "Alfamart run"]), tags: ["Essential"] });
      }
      if (rng() < 0.35) {
        rows.push({ type: "expense", account: "gopay", category: "Transport", amount: roundTo(between(18, 95) * 1000, 1000), cur: "IDR", at: at(day, 7), note: pick(["Gojek ride", "Grab to office", "KRL top up", "MRT Jakarta"]) });
      }
      if (weekend && rng() < 0.3) {
        rows.push({ type: "expense", account: "cc", category: pick(["Entertainment", "Shopping"] as const), amount: roundTo(between(120, 850) * 1000, 5000), cur: "IDR", at: at(day, 15), note: pick(["Cinema tickets", "Uniqlo", "Steam game", "Tokopedia order", "Concert tickets"]), tags: ["Treat yourself"] });
      }
      if (day % 14 === 0) {
        rows.push({ type: "expense", account: "bca", category: "Gasoline", amount: roundTo(between(150, 300) * 1000, 10000), cur: "IDR", at: at(day, 18), note: "Pertamina Pertamax" });
      }
      if (day % 11 === 0) {
        rows.push({ type: "expense", account: "bca", category: "Pet", amount: roundTo(between(90, 260) * 1000, 5000), cur: "IDR", at: at(day, 16), note: pick(["Cat food & litter", "Vet check-up", "Pet shop"]) });
      }
      if (day === 12 && m % 2 === 1) {
        rows.push({ type: "expense", account: "bca", category: "Health", amount: between(180, 650) * 1000, cur: "IDR", at: at(day, 11), note: pick(["Dentist", "Pharmacy", "Gym membership"]) });
      }
    }

    // Pay off the month's card spending on the 26th, leaving only the current cycle outstanding
    if (inRange(26)) {
      const monthCardSpend = rows
        .filter((r) => r.account === "cc" && r.type === "expense" && r.status !== "pending" && r.at >= start && r.at.getMonth() === start.getMonth())
        .reduce((sum, r) => sum + r.amount, 0);
      if (monthCardSpend > 0) {
        rows.push({ type: "transfer", account: "bca", toAccount: "cc", amount: monthCardSpend, toAmount: monthCardSpend, cur: "IDR", at: at(26, 10), note: "Credit card payment" });
      }
    }
  }

  // A couple of pending items so the "pending" state shows up
  rows.push({ type: "expense", account: "cc", category: "Shopping", amount: 1_290_000, cur: "IDR", at: daysAgo(1, 14), note: "Headphones (authorization hold)", status: "pending" });
  rows.push({ type: "income", account: "wise", category: "Freelance", amount: 62_000, cur: "USD", at: daysAgo(0, 9), note: "Invoice #2041 (processing)", status: "pending" });

  return rows;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await wipeDemoUser(client);

    const userId = newId();
    await client.query(
      `INSERT INTO users (id, email, password_hash, display_name, main_currency_code, timezone, show_cents, accent_color, email_verified_at, onboarded_at)
       VALUES ($1, $2, $3, 'Alex Rivera', 'IDR', 'Asia/Jakarta', false, '#17181b', now(), now())`,
      [userId, DEMO_EMAIL, await hashPassword(DEMO_PASSWORD)]
    );

    // Categories (same defaults the app creates on registration + extras for a lived-in look)
    const defaults: Array<{ name: string; emoji: string; kind: "expense" | "income" }> = [
      { name: "Delivery", emoji: "🍕", kind: "expense" },
      { name: "Pet", emoji: "🐸", kind: "expense" },
      { name: "Gasoline", emoji: "⛽", kind: "expense" },
      { name: "Fruit", emoji: "🥝", kind: "expense" },
      { name: "Health", emoji: "🧬", kind: "expense" },
      { name: "Travel", emoji: "⛱️", kind: "expense" },
      { name: "Salary", emoji: "", kind: "income" },
      { name: "Bonus", emoji: "", kind: "income" },
      { name: "Refund", emoji: "", kind: "income" },
    ];
    const allCategories = [
      ...defaults,
      ...EXTRA_EXPENSE_CATEGORIES.map((c) => ({ ...c, kind: "expense" as const })),
      ...EXTRA_INCOME_CATEGORIES.map((c) => ({ ...c, kind: "income" as const })),
    ];
    const categoryIds = new Map<string, string>();
    for (const [i, c] of allCategories.entries()) {
      const id = newId();
      categoryIds.set(c.name, id);
      await client.query(
        "INSERT INTO categories (id, user_id, name, emoji, kind, sort_order, is_system) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, userId, c.name, c.emoji, c.kind, i, i < defaults.length]
      );
    }

    // Members
    const meId = newId();
    const partnerId = newId();
    await client.query("INSERT INTO members (id, user_id, name, initials, color, is_default) VALUES ($1,$2,'Alex Rivera','AR','#2563eb',true)", [meId, userId]);
    await client.query("INSERT INTO members (id, user_id, name, initials, color, is_default) VALUES ($1,$2,'Sam Rivera','SR','#db2777',false)", [partnerId, userId]);

    // Tags
    const tagIds = new Map<string, string>();
    for (const t of TAGS) {
      const id = newId();
      tagIds.set(t.name, id);
      await client.query("INSERT INTO tags (id, user_id, name, color) VALUES ($1,$2,$3,$4)", [id, userId, t.name, t.color]);
    }

    // Accounts
    const accountIds = new Map<AccountKey, string>();
    for (const [i, a] of ACCOUNTS.entries()) {
      const id = newId();
      accountIds.set(a.key, id);
      const limit = "limit" in a ? a.limit : null;
      const statementDay = "statementDay" in a ? a.statementDay : null;
      await client.query(
        `INSERT INTO accounts (id, user_id, name, type, currency_code, opening_balance, cached_balance, credit_limit, statement_day, icon, color, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11)`,
        [id, userId, a.name, a.type, a.cur, a.opening, limit, statementDay, a.icon, a.color, i]
      );
    }

    // Transactions
    const txns = buildTransactions();
    for (const t of txns) {
      const id = newId();
      await client.query(
        `INSERT INTO transactions (id, user_id, type, account_id, to_account_id, category_id, member_id, amount, currency_code, to_amount, occurred_at, note, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          userId,
          t.type,
          accountIds.get(t.account),
          t.toAccount ? accountIds.get(t.toAccount) : null,
          t.category ? categoryIds.get(t.category) : null,
          t.member === "partner" ? partnerId : meId,
          t.amount,
          t.cur,
          t.toAmount ?? null,
          t.at,
          t.note,
          t.status ?? "cleared",
        ]
      );
      for (const tag of t.tags ?? []) {
        await client.query("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ($1,$2)", [id, tagIds.get(tag)]);
      }
    }

    // Budgets (monthly, IDR)
    const budgets: Array<[string, string | null, number]> = [
      ["Groceries", "Groceries", 3_000_000],
      ["Eating out & delivery", "Eating Out", 3_500_000],
      ["Coffee", "Coffee", 900_000],
      ["Transport", "Transport", 1_000_000],
      ["Entertainment", "Entertainment", 1_500_000],
      ["Overall monthly spending", null, 14_000_000],
    ];
    for (const [name, cat, limit] of budgets) {
      await client.query(
        `INSERT INTO budgets (id, user_id, category_id, name, limit_amount, currency_code, period, start_date, rollover_unused)
         VALUES ($1,$2,$3,$4,$5,'IDR','monthly',$6,$7)`,
        [newId(), userId, cat ? categoryIds.get(cat) : null, name, limit, monthStart(-MONTHS_OF_HISTORY), name === "Groceries"]
      );
    }

    // Savings goals
    // Left unlinked from accounts: linked goals derive progress from the account's balance change,
    // unlinked ones use contributed_amount, which is what we want to show here.
    const goals: Array<[string, string, number, number, string, number]> = [
      ["Emergency fund", "🛟", 60_000_000, 38_500_000, "IDR", 300],
      ["Japan trip", "🗾", 35_000_000, 12_800_000, "IDR", 210],
      ["New laptop", "💻", 22_000_000, 18_700_000, "IDR", 75],
      ["Wedding gift fund", "🎁", 5_000_000, 5_000_000, "IDR", 20],
    ];
    for (const [name, emoji, target, contributed, cur, daysAhead] of goals) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysAhead);
      await client.query(
        `INSERT INTO savings_goals (id, user_id, name, emoji, target_amount, contributed_amount, currency_code, target_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId(), userId, name, emoji, target, contributed, cur, targetDate, contributed >= target ? "achieved" : "active"]
      );
    }

    // Recurring rules (next run in the future so the background job doesn't post duplicates)
    const nextMonth = (day: number) => new Date(new Date().getFullYear(), new Date().getMonth() + 1, day, 9, 0, 0);
    const startsOn = monthStart(-MONTHS_OF_HISTORY);
    const rules: Array<{ name: string; type: "expense" | "income" | "transfer"; acc: AccountKey; to?: AccountKey; cat?: string; amount: number; day: number }> = [
      { name: "Monthly salary", type: "income", acc: "bca", cat: "Salary", amount: 15_500_000, day: 1 },
      { name: "Apartment rent", type: "expense", acc: "bca", cat: "Rent", amount: 3_800_000, day: 2 },
      { name: "Netflix & Spotify", type: "expense", acc: "cc", cat: "Subscriptions", amount: 186_000, day: 6 },
      { name: "Auto-invest to Bibit", type: "transfer", acc: "bca", to: "bibit", amount: 2_000_000, day: 8 },
      { name: "Gym membership", type: "expense", acc: "bca", cat: "Health", amount: 450_000, day: 12 },
    ];
    for (const r of rules) {
      await client.query(
        `INSERT INTO recurring_rules (id, user_id, name, txn_type, account_id, to_account_id, category_id, member_id, amount, currency_code, frequency, interval_count, day_of_month, starts_on, next_run_at, last_run_at, auto_post)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IDR','monthly',1,$10,$11,$12,$13,true)`,
        [newId(), userId, r.name, r.type, accountIds.get(r.acc), r.to ? accountIds.get(r.to) : null, r.cat ? categoryIds.get(r.cat) : null, meId, r.amount, r.day, startsOn, nextMonth(r.day), monthStart(0)]
      );
    }

    // Cached balances are derived from the transaction history
    for (const id of accountIds.values()) await recomputeAccountBalance(client, id);

    await client.query("COMMIT");
    console.log(`Seeded ${txns.length} transactions for ${DEMO_EMAIL} (password: ${DEMO_PASSWORD})`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
