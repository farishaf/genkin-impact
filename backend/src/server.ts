import { app } from "./app.js";
import { env } from "./env.js";
import { runRecurringRulesTick } from "./jobs/runRecurringRules.js";

app.listen(env.PORT, () => {
  console.log(`Genkin-Impact API listening on :${env.PORT}`);
});

// ponytail: single setInterval, in-process — fine for one dev/single-instance deploy.
// Doesn't survive multiple app instances (each would tick independently) or dedupe across
// restarts; move to a real job runner (or a DB-level "claim" lock) if that becomes true.
const HOUR_MS = 60 * 60 * 1000;
runRecurringRulesTick().catch((err) => console.error("recurring rules tick failed", err));
setInterval(() => {
  runRecurringRulesTick().catch((err) => console.error("recurring rules tick failed", err));
}, HOUR_MS);
