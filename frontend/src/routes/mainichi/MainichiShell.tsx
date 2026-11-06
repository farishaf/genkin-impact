import { Link, NavLink, Outlet, useMatch } from "react-router-dom";
import { useCurrentUser, useLogout } from "../../hooks/useAuth";
import { useConvention, useTheme } from "../../hooks/useDisplayPrefs";
import { flushSaves, useSaveState } from "../../lib/planner";
import { Icon } from "./parts";
import "../../styles/mainichi.css";

const navClass = ({ isActive }: { isActive: boolean }) => `mi-nav__item${isActive ? " mi-nav__item--active" : ""}`;

function SaveStatus() {
  const state = useSaveState();
  if (state === "saving") return <span className="mi-save">Saving…</span>;
  if (state === "error")
    return (
      <button type="button" className="mi-save mi-save--error" onClick={flushSaves}>
        Couldn't save · Retry
      </button>
    );
  return null;
}

function MoneyNav() {
  const inMoney = !!useMatch("/mainichi/money/*");
  // The key resets it on entering or leaving Money; between those the native element owns open/closed.
  return (
    <details key={String(inMoney)} className="mi-nav__group" open={inMoney}>
      <summary className={navClass({ isActive: inMoney })}>
        Money
        <Icon name="chevron" />
      </summary>
      <div className="mi-nav__sub">
        {MONEY_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={navClass}>
            {t.label}
          </NavLink>
        ))}
      </div>
    </details>
  );
}

export function MainichiShell() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  const { convention, setConvention } = useConvention();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="mi mi-shell" style={{ ["--color-accent-override" as string]: user?.accent_color || undefined }}>
      <aside className="mi-side">
        <Link to="/mainichi" className="mi-brand">
          <span className="mi-brand__mark">M</span>
          <span className="mi-brand__name">Mainichi</span>
        </Link>
        <nav className="mi-nav" aria-label="Mainichi">
          <NavLink to="/mainichi" end className={navClass}>
            Today
          </NavLink>
          <NavLink to="/mainichi/calendar" className={navClass}>
            Calendar
          </NavLink>
          <MoneyNav />
        </nav>
        <div className="mi-side__foot">
          <SaveStatus />
          <span className="mi-side__date">{today}</span>
          <div className="mi-side__actions">
            <button
              type="button"
              className="mi-pill mi-side__opt"
              onClick={() => setConvention(convention === "western" ? "eastern" : "western")}
              title="Which colour means a gain. Eastern: red. Western: green."
            >
              Gain: {convention === "western" ? "green" : "red"}
            </button>
            <button type="button" className="mi-pill" onClick={() => setTheme(nextTheme)} aria-label={`Switch to ${nextTheme} theme`}>
              <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            </button>
            <button type="button" className="mi-pill" onClick={() => logout.mutate()}>
              Log out
            </button>
          </div>
        </div>
      </aside>
      <main className="mi-main">
        <Outlet />
      </main>
      <nav className="mi-tabbar" aria-label="Mainichi">
        <NavLink to="/mainichi" end className={navClass}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5Z" /></svg>
          Today
        </NavLink>
        <NavLink to="/mainichi/calendar" className={navClass}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 5ZM3.5 10h17M8 3v4M16 3v4" /></svg>
          Calendar
        </NavLink>
        <NavLink to="/mainichi/money" className={navClass}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM3 10h18M16 14.5h2" /></svg>
          Money
        </NavLink>
      </nav>
    </div>
  );
}

const MONEY_TABS = [
  { to: "/mainichi/money", label: "Overview", end: true },
  { to: "/mainichi/money/transactions", label: "Transactions" },
  { to: "/mainichi/money/assets", label: "Assets" },
  { to: "/mainichi/money/analytics", label: "Analytics" },
  { to: "/mainichi/money/plans", label: "Plans" },
];

// Genkin-Impact pages live here. The sidebar dropdown navigates them; these pills only show on phones, which have no sidebar.
export function MoneyLayout() {
  return (
    <>
      <nav className="mi-filters mi-moneytabs" aria-label="Money">
        {MONEY_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `mi-chip-btn${isActive ? " mi-chip-btn--on" : ""}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
