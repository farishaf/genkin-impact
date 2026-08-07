import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { env } from "./env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { currenciesRouter } from "./routes/currencies.js";
import { usersRouter } from "./routes/users.js";
import { accountsRouter } from "./routes/accounts.js";
import { transactionsRouter } from "./routes/transactions.js";
import { categoriesRouter } from "./routes/categories.js";
import { membersRouter } from "./routes/members.js";
import { tagsRouter } from "./routes/tags.js";
import { budgetsRouter } from "./routes/budgets.js";
import { savingsGoalsRouter } from "./routes/savingsGoals.js";
import { recurringRulesRouter } from "./routes/recurringRules.js";
import { analyticsRouter } from "./routes/analytics.js";
import { savedFiltersRouter } from "./routes/savedFilters.js";
import { attachmentsRouter } from "./routes/attachments.js";

export const app = express();

app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/currencies", currenciesRouter);

app.use("/accounts", accountsRouter);
app.use("/transactions", transactionsRouter);
app.use("/categories", categoriesRouter);
app.use("/members", membersRouter);
app.use("/tags", tagsRouter);

app.use("/budgets", budgetsRouter);
app.use("/savings-goals", savingsGoalsRouter);
app.use("/recurring-rules", recurringRulesRouter);
app.use("/analytics", analyticsRouter);
app.use("/saved-filters", savedFiltersRouter);
app.use("/", attachmentsRouter);

app.use(errorHandler);
