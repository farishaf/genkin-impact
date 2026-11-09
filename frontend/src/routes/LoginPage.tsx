import type { CSSProperties } from "react";
import { LoginForm } from "../components/LoginForm";
import { RegisterForm } from "../components/RegisterForm";

// A day's checklist in front of a receipt, with a coin and a small savings chart.
// Shapes only, coloured by tokens in mainichi.css, so it follows light and dark.
function EverydayArt() {
  return (
    <svg className="mi-art" viewBox="0 0 360 270" aria-hidden="true">
      <path className="mi-art__spark" d="M326 18l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" />
      <path className="mi-art__spark mi-art__spark--sm" d="M22 228l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />

      {/* Intro: each .mi-art__pop rises in on its --d delay (receipt, then checklist, then coin); the float lives one level in. */}
      <g className="mi-art__pop">
        <g className="mi-art__float mi-art__float--b">
          <g className="mi-art__card" transform="translate(178 26) rotate(6)">
            <path d="M0 14Q0 0 14 0H136Q150 0 150 14V192l-12.5-8-12.5 8-12.5-8-12.5 8-12.5-8-12.5 8-12.5-8-12.5 8-12.5-8-12.5 8-12.5-8L0 192Z" />
            <circle className="mi-art__accent" cx="24" cy="24" r="8" />
            <rect className="mi-art__ink" x="40" y="20" width="56" height="8" rx="4" />
            {[50, 70, 90, 110].map((y, i) => (
              <g key={y}>
                <rect className="mi-art__muted" x="18" y={y} width={[62, 48, 70, 40][i]} height="6" rx="3" />
                <rect className="mi-art__muted" x="106" y={y} width="26" height="6" rx="3" />
              </g>
            ))}
            <line className="mi-art__rule" x1="18" y1="132" x2="132" y2="132" />
            <rect className="mi-art__muted" x="18" y="150" width="34" height="6" rx="3" />
            <text className="mi-art__total" x="132" y="158" textAnchor="end">Rp 48.000</text>
          </g>
        </g>
      </g>

      <g className="mi-art__pop" style={{ "--d": "460ms" } as CSSProperties}>
        <g className="mi-art__float">
          <g className="mi-art__chip" transform="translate(34 18)">
            <rect width="104" height="52" rx="14" />
            {[18, 26, 22, 34, 30].map((h, i) => (
              <rect className="mi-art__bar" key={i} x={14 + i * 16} y={40 - h} width="10" height={h} rx="3" />
            ))}
          </g>
        </g>
      </g>

      <g className="mi-art__pop" style={{ "--d": "200ms" } as CSSProperties}>
        <g className="mi-art__float mi-art__float--a">
          <g className="mi-art__card" transform="translate(24 86) rotate(-5)">
            <rect width="184" height="152" rx="18" />
            <rect className="mi-art__ink" x="18" y="18" width="64" height="9" rx="4.5" />
            <rect className="mi-art__accent" x="146" y="16" width="22" height="13" rx="6.5" />
            {[50, 84, 118].map((y, i) => (
              <g key={y}>
                <rect className={i < 2 ? "mi-art__done" : "mi-art__box"} x="18" y={y} width="20" height="20" rx="7" />
                {i < 2 && <path className="mi-art__tick" style={{ animationDelay: `${760 + i * 220}ms` }} d={`M23 ${y + 10.5}l4 4 7-8`} />}
                <rect className={i < 2 ? "mi-art__muted" : "mi-art__ink"} x="50" y={y + 7} width={[96, 72, 108][i]} height="7" rx="3.5" />
              </g>
            ))}
          </g>
        </g>
      </g>

      <g className="mi-art__pop" style={{ "--d": "420ms" } as CSSProperties}>
        <g className="mi-art__float mi-art__float--c">
          <circle className="mi-art__coin" cx="214" cy="222" r="28" />
          <circle className="mi-art__coin-ring" cx="214" cy="222" r="20" />
          <text className="mi-art__coin-text" x="214" y="228" textAnchor="middle">Rp</text>
        </g>
      </g>
    </svg>
  );
}

// Serves /login and /register: same panel, only the form swaps.
export function LoginPage({ mode = "login" }: { mode?: "login" | "register" }) {
  return (
    <div className="mi mi-login">
      <aside className="mi-login__panel">
        <div className="mi-brand">
          <span className="mi-brand__mark" lang="ja">ヒ</span>
          <span className="mi-brand__name" lang="ja">ヒツネ</span>
        </div>
        <EverydayArt />
        <p className="mi-login__meaning">Your tasks, plans and money in one place.</p>
      </aside>
      <main className="mi-login__main">
        <div className="mi-login__form">
          <div className="mi-login__head">
            <h1 className="mi-h1 mi-login__title">{mode === "register" ? "Create your account" : "Sign in"}</h1>
            <p className="mi-login__sub">{mode === "register" ? "Start your everyday with Hitsune." : "Welcome back to Hitsune."}</p>
          </div>
          {mode === "register" ? <RegisterForm /> : <LoginForm />}
        </div>
      </main>
    </div>
  );
}
