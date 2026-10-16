import { formatAmount } from "../lib/formatAmount";
import { hueStyle } from "../lib/categoryHue";
import { ActivityIcon, InsightsIcon, PlusIcon, TargetIcon, WalletIcon } from "./TxnIcons";

// Sample ledger for the marketing mockup — not customer data, not a claim. IDR minor units so it
// renders through the same formatAmount the real app uses.
const CURRENCY = "IDR";
const DEMO = {
  balance: "7318000",
  keptPct: 47,
  rows: [
    { name: "Coffee", note: "Kopi Kenangan", amount: "38000" },
    { name: "Transport", note: "KRL top up", amount: "21000" },
    { name: "Eating Out", note: "Lunch with team", amount: "129000" },
  ],
};

// Four weeks as heat levels: 0 quiet, 1–3 spend intensity, g = a day that earned more than it spent.
const HEAT = "0g12010301210013021g02103021".split("");

function rp(minor: string): string {
  return formatAmount(minor, CURRENCY);
}

/** Static, decorative phone showing the real app's Activity screen. Hidden from assistive tech. */
export function LandingPhone() {
  return (
    <div className="phone" aria-hidden="true">
      <div className="phone__screen">
        <div className="phone__status">
          <span>9:41</span>
          <span className="phone__island" />
          <span className="phone__battery" />
        </div>

        <div className="phone__head">
          <span className="phone__eyebrow">YOUR LEDGER</span>
          <span className="phone__title">Activity</span>
        </div>

        <div className="phone__hero">
          <span className="phone__eyebrow phone__eyebrow--accent">NET · OCTOBER</span>
          <div className="phone__figure">
            <small>IDR</small>
            {rp(DEMO.balance)}
          </div>
          <span className="phone__note">You kept {DEMO.keptPct}% of what came in.</span>
          <div className="phone__flow">
            <i style={{ flexBasis: "65%" }} data-tone="in" />
            <i style={{ flexBasis: "35%" }} data-tone="out" />
          </div>
        </div>

        <div className="phone__heat">
          {HEAT.map((h, i) => (
            <i key={i} data-h={h} />
          ))}
        </div>

        <div className="phone__list">
          <span className="phone__day">Today</span>
          {DEMO.rows.map((r) => (
            <div className="phone__row" key={r.name}>
              <span className="phone__badge" style={hueStyle(r.name)}>
                {r.name.charAt(0)}
              </span>
              <span className="phone__row-body">
                <b>{r.name}</b>
                <small>{r.note}</small>
              </span>
              <span className="phone__amt">-{rp(r.amount)}</span>
            </div>
          ))}
        </div>

        <div className="phone__tabbar">
          <span data-active="true">
            <ActivityIcon size={16} />
          </span>
          <span>
            <WalletIcon size={16} />
          </span>
          <span className="phone__fab">
            <PlusIcon size={16} />
          </span>
          <span>
            <InsightsIcon size={16} />
          </span>
          <span>
            <TargetIcon size={16} />
          </span>
        </div>
      </div>
    </div>
  );
}
