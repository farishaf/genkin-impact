import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useCurrentUser, useLogout } from "../hooks/useAuth";
import { useConvention, useTheme } from "../hooks/useDisplayPrefs";

export function AppShell() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  const { convention, setConvention } = useConvention();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <div className="app" style={{ ["--color-accent" as string]: user?.accent_color || undefined }}>
      <div className="topbar">
        <button className="menu-btn" type="button" aria-label="Toggle menu" onClick={() => setDrawerOpen((v) => !v)}>
          ☰
        </button>
        <div className="brand">
          <div className="brand-mark">G</div>
          <span className="brand-name">Genkin-Impact</span>
        </div>
        <div className="topbar-spacer" />
        {user?.main_currency_code && <span className="cur-btn">{user.main_currency_code}</span>}
        <button
          className="btn-outline btn-outline--sm"
          type="button"
          onClick={() => setConvention(convention === "western" ? "eastern" : "western")}
          title="Which colour means a gain. Eastern: red. Western: green."
        >
          Gain: {convention === "western" ? "green" : "red"}
        </button>
        <button
          className="btn-outline btn-outline--sm"
          type="button"
          onClick={() => setTheme(nextTheme)}
          aria-label={`Switch to ${nextTheme} theme`}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
        </button>
        <button className="btn-outline" type="button" onClick={() => logout.mutate()}>
          Log out
        </button>
      </div>
      <div className="body-row">
        <aside className={`sidebar${drawerOpen ? " sidebar--open" : ""}`}>
          <div className="sidebar-inner">
            <NavLink to="/app/transactions" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
              Transactions
            </NavLink>
            <NavLink to="/app/assets" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
              Assets
            </NavLink>
            <NavLink to="/app/analytics" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
              Analytics
            </NavLink>
            <NavLink to="/app/plans" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
              Plans
            </NavLink>
          </div>
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
