import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCurrentUser } from "../hooks/useAuth";
import { useTheme } from "../hooks/useDisplayPrefs";
import { formatAmount } from "../lib/formatAmount";
import "../styles/landing.css";

// Preview figures for the marketing panel. Not a customer metric, not a claim — a sample ledger,
// in IDR minor units so it renders through the same formatAmount the real app uses.
const DEMO = {
  currency: "IDR",
  income: "18450000",
  expenditure: "9275000",
  balance: "9175000",
  count: 128,
  dayOut: "685000",
  rows: [
    {
      key: "K",
      name: "Kopi",
      time: "09:41",
      meta: "BCA · Food & drink",
      amount: "45000",
    },
    {
      key: "T",
      name: "Transport",
      time: "08:12",
      meta: "GoPay · Daily",
      amount: "28000",
    },
    {
      key: "L",
      name: "Listrik",
      time: "07:30",
      meta: "BCA · Utilities",
      amount: "612000",
    },
  ],
};

function rp(minorUnits: string) {
  return `Rp ${formatAmount(minorUnits, DEMO.currency)}`;
}

// 28 cells = four weeks. Fixed pattern, not random, so the miniature is stable across renders.
const HEAT = "..o.....O..o....o...O....o.i".split("");
const HEAT_KIND: Record<string, string | undefined> = {
  o: "out-lo",
  O: "out-hi",
  i: "in",
};
const BARS = [30, 52, 41, 68, 34, 88, 46, 61, 29, 74, 38, 55];
const BAR_IN = new Set([5, 9]);

export function LandingPage() {
  const { data: user } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          ".lp-rise",
          { opacity: 0, y: 16 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            ease: "power2.out",
            stagger: 0.08,
          },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  // Signed-in visitors never see the marketing page; the app guards handle onboarding from there.
  if (user) return <Navigate to="/app/transactions" replace />;

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <div className="lp" ref={root}>
      <header className="lp-nav" data-scrolled={scrolled}>
        <nav className="lp-shell lp-nav__inner" aria-label="Main">
          <a className="lp-brand" href="#top">
            <span className="lp-brand__mark" aria-hidden="true">
              G
            </span>
            Genkin-Impact
          </a>
          <div className="lp-nav__links">
            <a className="lp-nav__link" href="#features">
              Features
            </a>
            <a className="lp-nav__link" href="#analytics">
              Analytics
            </a>
            <a className="lp-nav__link" href="#privacy">
              Privacy
            </a>
          </div>
          <div className="lp-nav__end">
            <button
              className="lp-theme-btn"
              type="button"
              onClick={() => setTheme(nextTheme)}
              aria-label={`Switch to ${nextTheme} theme`}
            >
              <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            </button>
            <Link className="lp-nav__signin" to="/login">
              Sign in
            </Link>
            <Link className="lp-btn lp-btn--ink lp-btn--sm" to="/register">
              Sign up
            </Link>
          </div>
        </nav>
      </header>

      <main id="top">
        <section className="lp-shell lp-hero">
          <h1 className="lp-hero__title lp-rise">Finance, simplified.</h1>
          <p className="lp-hero__lede lp-rise">
            Every transaction, account and plan in one ledger — with the
            heatmaps and trends that show where the money actually went.
          </p>

          <div className="lp-stage lp-rise">
            <div className="lp-orbs" aria-hidden="true">
              <span className="lp-orb lp-orb--a" />
              <span className="lp-orb lp-orb--b" />
              <span className="lp-orb lp-orb--c" />
            </div>

            <div className="lp-glass lp-panel">
              <div className="lp-panel__head">
                <h2 className="lp-panel__title">Daily</h2>
                <span className="lp-panel__count">{DEMO.count}</span>
                <div className="lp-seg" role="presentation">
                  <span data-active="true">List</span>
                  <span>Calendar</span>
                  <span>Table</span>
                </div>
              </div>

              <div className="lp-stats">
                <div className="lp-stat">
                  <div className="lp-stat__head">
                    <span
                      className="lp-stat__dot"
                      style={{ background: "var(--color-income)" }}
                      aria-hidden="true"
                    />
                    <span className="lp-stat__label">Income</span>
                  </div>
                  <div className="lp-stat__value" data-tone="income">
                    +{rp(DEMO.income)}
                  </div>
                </div>
                <div className="lp-stat">
                  <div className="lp-stat__head">
                    <span
                      className="lp-stat__dot"
                      style={{ background: "var(--color-expense)" }}
                      aria-hidden="true"
                    />
                    <span className="lp-stat__label">Expenditure</span>
                  </div>
                  <div className="lp-stat__value" data-tone="expense">
                    −{rp(DEMO.expenditure)}
                  </div>
                </div>
                <div className="lp-stat">
                  <div className="lp-stat__head">
                    <span
                      className="lp-stat__dot"
                      style={{ background: "var(--color-balance)" }}
                      aria-hidden="true"
                    />
                    <span className="lp-stat__label">Balance</span>
                  </div>
                  <div className="lp-stat__value" data-tone="balance">
                    +{rp(DEMO.balance)}
                  </div>
                </div>
                <div className="lp-stat">
                  <div className="lp-stat__head">
                    <span
                      className="lp-stat__dot"
                      style={{ background: "var(--color-on-surface-muted)" }}
                      aria-hidden="true"
                    />
                    <span className="lp-stat__label">Transactions</span>
                  </div>
                  <div className="lp-stat__value">{DEMO.count}</div>
                </div>
              </div>

              <div className="lp-daybar">
                <span>Fri, Today</span>
                <span className="lp-daybar__out">−{rp(DEMO.dayOut)}</span>
                <span className="lp-daybar__in">+Rp 0</span>
              </div>

              <div>
                {DEMO.rows.map((row, i) => (
                  <div
                    className={`lp-txn${i === DEMO.rows.length - 1 ? " lp-txn--fade" : ""}`}
                    key={row.name}
                  >
                    <span className="lp-txn__badge" aria-hidden="true">
                      {row.key}
                    </span>
                    <div className="lp-txn__body">
                      <div className="lp-txn__top">
                        <span className="lp-txn__name">{row.name}</span>
                        <span className="lp-txn__time">{row.time}</span>
                      </div>
                      <div className="lp-txn__meta">{row.meta}</div>
                    </div>
                    <span className="lp-txn__amount">−{rp(row.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bottom-section" id="features">
          <h2 className="lp-section__title">Why Genkin?</h2>
          <div className="lp-tiles">
            <article className="lp-tile">
              <h3 className="lp-tile__title">Visual heatmap</h3>
              <p className="lp-tile__body">
                A month of spending as one grid. Heavy days stand out before you
                read a single number.
              </p>
              <div className="lp-tile__art">
                <div className="lp-heat" aria-hidden="true">
                  {HEAT.map((c, i) => (
                    <i key={i} data-h={HEAT_KIND[c]} />
                  ))}
                </div>
              </div>
            </article>

            <article className="lp-tile" id="analytics">
              <h3 className="lp-tile__title">Spending trends</h3>
              <p className="lp-tile__body">
                Income against expenditure over time, by category or account, so
                a bad month has an explanation.
              </p>
              <div className="lp-tile__art">
                <div className="lp-bars" aria-hidden="true">
                  {BARS.map((h, i) => (
                    <i
                      key={i}
                      style={{ height: `${h}%` }}
                      data-b={BAR_IN.has(i) ? "in" : "out"}
                    />
                  ))}
                </div>
              </div>
            </article>

            <article className="lp-tile">
              <h3 className="lp-tile__title">Recent activity</h3>
              <p className="lp-tile__body">
                Tags, members, accounts, attachments and refunds — the detail is
                there when you need to audit it.
              </p>
              <div className="lp-tile__art">
                <div className="lp-mini-rows" aria-hidden="true">
                  {DEMO.rows.map((row) => (
                    <div className="lp-mini-row" key={row.name}>
                      <span className="lp-mini-row__badge">{row.key}</span>
                      <span className="lp-mini-row__name">{row.name}</span>
                      <span className="lp-mini-row__amt">
                        −{rp(row.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="lp-shell lp-close">
          <h2 className="lp-close__title">Start with today's coffee.</h2>
          <Link className="lp-btn lp-btn--ink" to="/register">
            Create your ledger
          </Link>
          <p className="lp-close__note">
            Free while in development. No card, no bank linking.
          </p>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-shell lp-foot__inner">
          <span>© 2026 Genkin-Impact</span>
          <span aria-hidden="true">·</span>
          <span>Built for people who read their own ledger.</span>
          <div className="lp-foot__links">
            <Link to="/login">Sign in</Link>
            <Link to="/register">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
