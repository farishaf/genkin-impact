import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useCurrentUser } from "../hooks/useAuth";
import { LandingPhone } from "../components/LandingPhone";
import { ArrowIcon, BrandMark } from "../components/TxnIcons";
import "../styles/landing.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const ANNOTATIONS = [
  { id: "heat", label: "Daily heatmap", body: "Heavy days glow before you read a number." },
  { id: "kept", label: "Savings rate", body: "How much you kept — in one sentence." },
  { id: "plans", label: "Budgets & goals", body: "Warned at 80%, not after the damage." },
  { id: "fx", label: "Multi-currency", body: "Rupiah, dollars, yen — one total." },
] as const;

const FEATURES = [
  {
    id: "heatmap",
    eyebrow: "Insights",
    title: "Your month as a heatmap",
    body: "Every day is a square. The expensive ones light up, so patterns show up before you start doing maths.",
    art: "heat",
  },
  {
    id: "kept",
    eyebrow: "Clarity",
    title: "“You kept 37%.”",
    body: "Not a wall of charts. One honest sentence about what came in and what stayed.",
    art: "kept",
  },
  {
    id: "budgets",
    eyebrow: "Plans",
    title: "Budgets that nudge early",
    body: "On track, getting close, over. You hear about it while there's still time to change course.",
    art: "budgets",
  },
  {
    id: "split",
    eyebrow: "Real life",
    title: "Refunds, splits, receipts",
    body: "Pay-later in four? Refund came through? Snap of the bill? It all stays attached to the entry.",
    art: "split",
  },
] as const;

const STEPS = [
  { n: "01", title: "Add where your money lives", body: "Bank, e-wallet, the cash in your pocket. No bank login, ever." },
  { n: "02", title: "Log it in five seconds", body: "Tap +, type the amount, pick a category. Recurring stuff logs itself." },
  { n: "03", title: "Read your month", body: "Heatmap, breakdown, savings rate. Know where it went — and what to change." },
] as const;

const BUDGET_SAMPLES = [
  { name: "Coffee", pct: 34, tone: "ok" },
  { name: "Eating out", pct: 82, tone: "warn" },
  { name: "Shopping", pct: 104, tone: "danger" },
] as const;

// Four-and-a-bit weeks of heat levels for the feature tile: 0 quiet, 1–3 spend, g = earned-more day.
const HEAT = "0012010301210013021g02103021012g".split("");

function FeatureArt({ kind }: { kind: (typeof FEATURES)[number]["art"] }) {
  if (kind === "heat") {
    return (
      <div className="art-heat" aria-hidden="true">
        {HEAT.map((h, i) => (
          <i key={i} data-h={h} />
        ))}
      </div>
    );
  }
  if (kind === "kept") {
    return (
      <div className="art-kept" aria-hidden="true">
        <span className="art-kept__num">
          37<small>%</small>
        </span>
        <span className="art-kept__bar">
          <i style={{ flexBasis: "62%" }} data-tone="in" />
          <i style={{ flexBasis: "38%" }} data-tone="out" />
        </span>
      </div>
    );
  }
  if (kind === "budgets") {
    return (
      <div className="art-budgets" aria-hidden="true">
        {BUDGET_SAMPLES.map((b) => (
          <div className="art-budgets__row" key={b.name}>
            <span>{b.name}</span>
            <span className="art-budgets__pct" data-tone={b.tone}>
              {b.pct}%
            </span>
            <span className="art-budgets__track">
              <i style={{ width: `${Math.min(b.pct, 100)}%` }} data-tone={b.tone} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="art-split" aria-hidden="true">
      <div className="art-split__steps">
        {["1/4", "2/4", "3/4", "4/4"].map((s, i) => (
          <span key={s} data-paid={i < 2}>
            {s}
          </span>
        ))}
      </div>
      <div className="art-split__chips">
        <span>↺ Refund</span>
        <span>📎 Receipt</span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { data: user } = useCurrentUser();
  const [scrolled, setScrolled] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const authState = { background: location };

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
        gsap
          .timeline({ defaults: { ease: "expo.out" } })
          .from(".lp-rise", { opacity: 0, y: 24, duration: 1.1, stagger: 0.08 })
          .from(".phone", { opacity: 0, y: 80, rotateX: 16, duration: 1.4 }, "-=0.9")
          .from(".lp-note", { opacity: 0, y: 12, duration: 0.9, stagger: 0.1 }, "-=0.9")
          .from(".lp-note__line", { scaleX: 0, duration: 0.8, stagger: 0.1 }, "<");

        gsap.utils.toArray<HTMLElement>(".lp-reveal").forEach((el) => {
          gsap.from(el, {
            opacity: 0,
            y: 32,
            duration: 1,
            ease: "expo.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  // Signed-in visitors never see the marketing page; the app guards handle onboarding from there.
  if (user) return <Navigate to="/app/transactions" replace />;

  return (
    <div className="lp" ref={root}>
      <div className="lp-bg" aria-hidden="true" />

      <header className="lp-nav" data-scrolled={scrolled}>
        <div className="lp-shell lp-nav__inner">
          <a className="lp-brand" href="#top" aria-label="Genkin home">
            <BrandMark size={30} />
            <span>Genkin</span>
          </a>
          <nav className="lp-pill" aria-label="Main">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <div className="lp-nav__end">
            <Link className="lp-signin" to="/login" state={authState}>
              Sign in
            </Link>
            <Link className="lp-cta lp-cta--sm" to="/register" state={authState}>
              Get started
              <span className="lp-cta__icon">
                <ArrowIcon size={14} />
              </span>
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="lp-shell lp-hero">
          <span className="lp-tag lp-rise">
            <i aria-hidden="true" /> For people who already check their balance
          </span>
          <h1 className="lp-hero__title lp-rise">
            <span className="dim">Your money,</span>
            <br />
            finally legible.
          </h1>
          <p className="lp-hero__lede lp-rise">
            <span className="dim">A calm, private ledger.</span> Log in seconds,{" "}
            <span className="dim">see your month as a</span> heatmap,{" "}
            <span className="dim">and know exactly</span> how much you kept.
          </p>
          <div className="lp-hero__actions lp-rise">
            <Link className="lp-cta" to="/register" state={authState}>
              Start your ledger
              <span className="lp-cta__icon">
                <ArrowIcon size={16} />
              </span>
            </Link>
            <a className="lp-ghost" href="#how">
              See how it works
            </a>
          </div>

          <div className="lp-stage">
            {ANNOTATIONS.map((a) => (
              <div className="lp-note" key={a.id} data-pos={a.id}>
                <span className="lp-note__label">{a.label}</span>
                <span className="lp-note__body">{a.body}</span>
                <span className="lp-note__line" aria-hidden="true" />
              </div>
            ))}
            <LandingPhone />
          </div>

          <div className="lp-hero__foot">
            <div className="lp-stat">
              <span className="lp-dots-icon" aria-hidden="true">
                {Array.from({ length: 9 }).map((_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span>
                <b>0 bank logins</b>
                <small>No card. No linking. Just you.</small>
              </span>
            </div>
            <span className="lp-scroll mono">Scroll ↓</span>
          </div>
        </section>

        <section className="lp-shell lp-section" id="features">
          <div className="lp-section__head lp-reveal">
            <span className="lp-eyebrow">// What you get</span>
            <h2 className="lp-h2">
              <span className="dim">Less tracking.</span> More knowing.
            </h2>
          </div>
          <div className="lp-bento">
            {FEATURES.map((f) => (
              <article className="lp-tile lp-reveal" key={f.id} data-art={f.art}>
                <div className="lp-tile__copy">
                  <span className="lp-eyebrow">{f.eyebrow}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
                <div className="lp-tile__art">
                  <FeatureArt kind={f.art} />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-shell lp-section" id="how">
          <div className="lp-section__head lp-reveal">
            <span className="lp-eyebrow">// How it works</span>
            <h2 className="lp-h2">
              <span className="dim">Three steps.</span> No spreadsheet.
            </h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li className="lp-step lp-reveal" key={s.n}>
                <span className="lp-step__n mono">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-shell lp-section lp-privacy" id="privacy">
          <div className="lp-privacy__copy lp-reveal">
            <span className="lp-eyebrow">// Privacy</span>
            <h2 className="lp-h2">
              <span className="dim">Your numbers stay</span> yours.
            </h2>
            <p className="lp-privacy__lede">
              Genkin never asks for a bank password or card number. You decide what goes in, and nothing
              moves unless you log it.
            </p>
          </div>
          <ul className="lp-checks lp-reveal">
            <li>
              <b>No bank linking</b>
              <span>You type it, or a recurring rule does.</span>
            </li>
            <li>
              <b>Your colours, your rules</b>
              <span>Red or green for a good month. Light or dark.</span>
            </li>
            <li>
              <b>Receipts kept with the entry</b>
              <span>Proof is one tap away when you need it.</span>
            </li>
          </ul>
        </section>

        <section className="lp-shell lp-close">
          <div className="lp-orb" aria-hidden="true" />
          <h2 className="lp-h2 lp-reveal">
            <span className="dim">Start with</span> today's coffee.
          </h2>
          <div className="lp-reveal">
            <Link className="lp-cta" to="/register" state={authState}>
              Create your ledger
              <span className="lp-cta__icon">
                <ArrowIcon size={16} />
              </span>
            </Link>
          </div>
          <p className="lp-close__note mono">Free while in development · No card needed</p>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-shell lp-foot__inner">
          <span className="lp-brand lp-brand--sm">
            <BrandMark size={22} />
            Genkin
          </span>
          <span className="mono">© 2026 · Built for people who read their own ledger</span>
          <div className="lp-foot__links">
            <Link to="/login" state={authState}>
              Sign in
            </Link>
            <Link to="/register" state={authState}>
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
