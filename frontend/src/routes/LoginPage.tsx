import { useState, type CSSProperties } from "react";
import { LoginForm } from "../components/LoginForm";
import { RegisterForm } from "../components/RegisterForm";
import "../styles/mainichi.css";

const MONTH_INITIALS = "JFMAMJJASOND";
const DAY_MS = 86_400_000;

function YearGrid({ today }: { today: Date }) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const date = today.getDate();
  return (
    <div className="mi-login__year" aria-hidden="true">
      {Array.from(MONTH_INITIALS, (initial, m) => (
        <div className="mi-login__month" key={m}>
          <span className="mi-login__initial">{initial}</span>
          {Array.from({ length: new Date(year, m + 1, 0).getDate() }, (_, i) => {
            const d = i + 1;
            const state = m === month && d === date ? " is-today" : m < month || (m === month && d < date) ? " is-past" : "";
            // Position in the year staggers the fill sweep (see .mi-login__day).
            const position = (Date.UTC(year, m, d) - Date.UTC(year, 0, 1)) / DAY_MS;
            return <span className={`mi-login__day${state}`} style={{ "--i": position } as CSSProperties} key={d} />;
          })}
        </div>
      ))}
    </div>
  );
}

// Serves /login and /register: same panel, only the form swaps.
export function LoginPage({ mode = "login" }: { mode?: "login" | "register" }) {
  const [today] = useState(() => new Date());
  const year = today.getFullYear();
  // UTC so a daylight-saving change can't shift the day count.
  const dayOfYear = (Date.UTC(year, today.getMonth(), today.getDate()) - Date.UTC(year, 0, 0)) / DAY_MS;
  const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;

  return (
    <div className="mi mi-login">
      <aside className="mi-login__panel">
        <div className="mi-brand">
          <span className="mi-brand__mark">M</span>
          <span className="mi-brand__name">Mainichi</span>
        </div>
        <div className="mi-login__story">
          <YearGrid today={today} />
          <p className="mi-login__meaning">
            <span lang="ja">毎日</span> means <span className="mi-login__accent">every day</span>. Your plan, workouts and money in one place.
          </p>
          <div className="mi-login__today">
            <span className="mi-login__badge">{today.getDate()}</span>
            <div>
              <p className="mi-login__date">{today.toLocaleDateString("en-GB", { month: "long" })}</p>
              <p className="mi-login__count">
                {today.toLocaleDateString("en-GB", { weekday: "long" })} · Day {dayOfYear} of {daysInYear}
              </p>
            </div>
          </div>
        </div>
      </aside>
      <main className="mi-login__main">
        <div className="mi-login__form">
          <div className="mi-login__head">
            <h1 className="mi-h1 mi-login__title">{mode === "register" ? "Create your account" : "Sign in"}</h1>
            <p className="mi-login__sub">{mode === "register" ? "Start planning with Mainichi." : "Welcome back to Mainichi."}</p>
          </div>
          {mode === "register" ? <RegisterForm /> : <LoginForm />}
        </div>
      </main>
    </div>
  );
}
