import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { env } from "./env.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Route mounts are added in later tasks:
// app.use("/auth", authRouter);
// app.use("/users", usersRouter);
// app.use("/currencies", currenciesRouter);
// app.use("/accounts", accountsRouter);
// app.use("/transactions", transactionsRouter);

app.use(errorHandler);
