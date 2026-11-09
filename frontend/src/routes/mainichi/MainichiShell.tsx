import { useId, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useCurrentUser, useLogout } from "../../hooks/useAuth";
import { useConvention, useTheme } from "../../hooks/useDisplayPrefs";
import { flushSaves, useSaveState } from "../../lib/planner";
import { Drawer, Icon } from "./parts";
import { CategoryManager } from "../../components/CategoryManager";
import { ENTER, reducedMotion } from "../../lib/motion";

gsap.registerPlugin(useGSAP);

const navClass = ({ isActive }: { isActive: boolean }) => `mi-nav__item${isActive ? " mi-nav__item--active" : ""}`;

function SaveStatus() {
  const state = useSaveState();
  if (state === "saving") return <span className="mi-save">Saving…</span>;
  if (state === "error")
    return (
      <button type="button" className="mi-save mi-save--error" onClick={flushSaves}>
        Couldn’t save, retry
      </button>
    );
  return null;
}

/** Theme, gain colour and sign-out. A native popover: it closes on an outside press and on Esc without any script. */
function AccountMenu({ label }: { label?: string }) {
  const menuId = useId();
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  const { convention, setConvention } = useConvention();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const [managing, setManaging] = useState(false);
  const initials =
    (user?.display_name ?? "")
      .trim()
      .split(/\s+/)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "M";
  return (
    <div className="mi-menu">
      <button type="button" className="mi-pill mi-menu__trigger" popoverTarget={menuId} aria-label="Account and display settings">
        <span className="mi-menu__initials">{initials}</span>
        {label ? <span className="mi-menu__label">{label}</span> : null}
      </button>
      <div
        id={menuId}
        popover="auto"
        className="mi-menu__panel"
        // beforetoggle fires while the panel is still hidden, so the from-state is set before its first paint.
        onBeforeToggle={(e) => {
          if (e.newState !== "open" || reducedMotion()) return;
          gsap.from(e.currentTarget, { autoAlpha: 0, y: -6, ...ENTER, duration: 0.16, clearProps: "opacity,visibility,transform" });
          gsap.from(e.currentTarget.children, { autoAlpha: 0, y: 4, ...ENTER, stagger: 0.03, delay: 0.04, clearProps: "opacity,visibility,transform" });
        }}
      >
        <button type="button" className="mi-menu__item" onClick={() => setTheme(nextTheme)} aria-label={`Switch to ${nextTheme} theme`}>
          Theme
          <span className="mi-menu__value">
            <Icon name={theme === "dark" ? "moon" : "sun"} />
            {theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"}
          </span>
        </button>
        <button
          type="button"
          className="mi-menu__item"
          onClick={() => setConvention(convention === "western" ? "eastern" : "western")}
          title="Which colour means a gain. Eastern: red. Western: green."
        >
          Gain colour
          <span className="mi-menu__value">{convention === "western" ? "Green" : "Red"}</span>
        </button>
        <p className="mi-menu__hint">Red is a gain in the eastern convention, green in the western one.</p>
        <button type="button" className="mi-menu__item" popoverTarget={menuId} popoverTargetAction="hide" onClick={() => setManaging(true)}>
          Categories
          <span className="mi-menu__value">Edit</span>
        </button>
        <button type="button" className="mi-menu__item" onClick={() => logout.mutate()}>
          Log out
          <span className="mi-menu__value">
            <Icon name="logout" />
          </span>
        </button>
      </div>
      {managing && (
        <Drawer title="Categories" onClose={() => setManaging(false)}>
          <CategoryManager />
        </Drawer>
      )}
    </div>
  );
}

const NAV_ICONS = {
  today: "M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5Z",
  calendar: "M5 5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 5ZM3.5 10h17M8 3v4M16 3v4",
  money: "M4 6h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM3 10h18M16 14.5h2",
} as const;

function NavIcon({ name }: { name: keyof typeof NAV_ICONS }) {
  return (
    <svg className="mi-nav__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={NAV_ICONS[name]} />
    </svg>
  );
}

const MONEY_TABS = [
  { to: "/mainichi/money", label: "Overview", end: true },
  { to: "/mainichi/money/transactions", label: "Transactions" },
  { to: "/mainichi/money/assets", label: "Assets" },
  { to: "/mainichi/money/analytics", label: "Analytics" },
  { to: "/mainichi/money/plans", label: "Plans" },
];

/** Money opens in place so every money page is one press away. It starts open on a money page and re-opens when you arrive on one. */
function MoneyGroup() {
  const { pathname } = useLocation();
  const isOnMoney = pathname.startsWith("/mainichi/money");
  const [isOpen, setIsOpen] = useState(isOnMoney);
  const [wasOnMoney, setWasOnMoney] = useState(isOnMoney);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const wasOpen = useRef(isOpen);

  // Opening the group drops its links in one by one. Not on first paint: the page already shows it open.
  useGSAP(
    () => {
      const opened = isOpen && !wasOpen.current;
      wasOpen.current = isOpen;
      if (!opened || !listRef.current || reducedMotion()) return;
      gsap.from(listRef.current.children, { autoAlpha: 0, y: -4, ...ENTER, stagger: 0.03, clearProps: "opacity,visibility,transform" });
    },
    { dependencies: [isOpen] },
  );

  // Arriving on a money page (a link elsewhere in the app) opens the group. Adjusted during render, not in an effect.
  if (isOnMoney !== wasOnMoney) {
    setWasOnMoney(isOnMoney);
    if (isOnMoney) setIsOpen(true);
  }

  const isCollapsedOnMoney = isOnMoney && !isOpen;
  return (
    <div className="mi-side__money">
      <button
        type="button"
        className={`mi-nav__item mi-side__group${isCollapsedOnMoney ? " mi-nav__item--active" : ""}`}
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <NavIcon name="money" />
        <span className="mi-side__label">Money</span>
        <Icon name="chevron" className={`mi-side__chev${isOpen ? " mi-side__chev--open" : ""}`} />
      </button>
      <ul id={listId} ref={listRef} className="mi-side__sub" hidden={!isOpen}>
        {MONEY_TABS.map((tab) => (
          <li key={tab.to}>
            <NavLink to={tab.to} end={tab.end} className={({ isActive }) => `${navClass({ isActive })} mi-nav__sub`}>
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Brand() {
  const dayOfMonth = new Date().getDate();
  return (
    <Link to="/mainichi" className="mi-brand" aria-label="ヒツネ, today">
      <span className="mi-brand__mark" aria-hidden="true">{dayOfMonth}</span>
      <span className="mi-brand__name" lang="ja">ヒツネ</span>
    </Link>
  );
}

export function MainichiShell() {
  return (
    <div className="mi mi-shell">
      {/* Phones: a slim top bar and the bottom tab bar. Wider screens: the sidebar. */}
      <header className="mi-top">
        <Brand />
        <div className="mi-top__spacer" />
        <SaveStatus />
        <AccountMenu />
      </header>
      <aside className="mi-side">
        <Brand />
        <nav className="mi-side__nav" aria-label="ヒツネ">
          <NavLink to="/mainichi" end className={navClass}>
            <NavIcon name="today" />
            Today
          </NavLink>
          <NavLink to="/mainichi/calendar" className={navClass}>
            <NavIcon name="calendar" />
            Calendar
          </NavLink>
          <MoneyGroup />
        </nav>
        <div className="mi-side__foot">
          <SaveStatus />
          <AccountMenu label="Account" />
        </div>
      </aside>
      <main className="mi-main">
        <Outlet />
      </main>
      <nav className="mi-tabbar" aria-label="ヒツネ">
        <NavLink to="/mainichi" end className={navClass}>
          <NavIcon name="today" />
          Today
        </NavLink>
        <NavLink to="/mainichi/calendar" className={navClass}>
          <NavIcon name="calendar" />
          Calendar
        </NavLink>
        <NavLink to="/mainichi/money" className={navClass}>
          <NavIcon name="money" />
          Money
        </NavLink>
      </nav>
    </div>
  );
}

// The pages that used to be Genkin-Impact live here, one tab each.
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
