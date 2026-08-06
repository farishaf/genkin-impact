import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useCurrentUser, useLogout } from "../hooks/useAuth";

export function AppShell() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);

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
          </div>
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
