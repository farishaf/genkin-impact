import type { ComponentType } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { SettingsMenu } from "../components/SettingsMenu";
import { ActivityIcon, BrandMark, InsightsIcon, PlusIcon, TargetIcon, WalletIcon } from "../components/TxnIcons";

interface NavEntry {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

const NAV: NavEntry[] = [
  { to: "/app/transactions", label: "Activity", Icon: ActivityIcon },
  { to: "/app/assets", label: "Accounts", Icon: WalletIcon },
  { to: "/app/analytics", label: "Insights", Icon: InsightsIcon },
  { to: "/app/plans", label: "Plans", Icon: TargetIcon },
];

// TransactionsPage opens its composer when it sees ?new=1, so "+" works from any tab.
const NEW_ENTRY = "/app/transactions?new=1";

function navClass({ isActive }: { isActive: boolean }) {
  return `nav-item${isActive ? " nav-item--active" : ""}`;
}

export function AppShell() {
  return (
    <div className="app">
      <aside className="rail" aria-label="Primary">
        <div className="rail__inner">
          <Link to="/app/transactions" className="brand">
            <BrandMark size={30} />
            <span className="brand-name">Genkin</span>
          </Link>

          <Link to={NEW_ENTRY} className="btn-cta btn-cta--block">
            <PlusIcon size={18} />
            New entry
          </Link>

          <nav className="rail__nav">
            <span className="eyebrow rail__label">Menu</span>
            {NAV.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} className={navClass}>
                <Icon size={19} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="rail__foot">
            <SettingsMenu placement="up" showIdentity />
          </div>
        </div>
      </aside>

      <header className="mobile-bar">
        <Link to="/app/transactions" className="brand">
          <BrandMark size={28} />
          <span className="brand-name">Genkin</span>
        </Link>
        <SettingsMenu placement="down" />
      </header>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Primary">
        {NAV.slice(0, 2).map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `tab${isActive ? " tab--active" : ""}`}>
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
        <Link to={NEW_ENTRY} className="tab-fab" aria-label="New entry">
          <PlusIcon size={24} />
        </Link>
        {NAV.slice(2).map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `tab${isActive ? " tab--active" : ""}`}>
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
