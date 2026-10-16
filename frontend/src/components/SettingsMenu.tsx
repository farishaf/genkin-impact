import { useEffect, useRef, useState } from "react";
import { useCurrentUser, useLogout } from "../hooks/useAuth";
import { useConvention, useTheme, type Convention, type Theme } from "../hooks/useDisplayPrefs";
import { LogoutIcon, SlidersIcon } from "./TxnIcons";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const CONVENTION_OPTIONS: { value: Convention; label: string }[] = [
  { value: "eastern", label: "Red" },
  { value: "western", label: "Green" },
];

interface SettingsMenuProps {
  /** Which way the panel opens from its trigger. */
  placement?: "up" | "down";
  /** Show the user's name next to the trigger icon (sidebar footer). */
  showIdentity?: boolean;
}

/** One quiet place for display preferences and sign-out, instead of a row of toolbar buttons. */
export function SettingsMenu({ placement = "down", showIdentity = false }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  const { convention, setConvention } = useConvention();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = (user?.display_name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <div className="settings" ref={wrapRef} data-placement={placement}>
      <button
        type="button"
        className={showIdentity ? "settings__trigger settings__trigger--identity" : "settings__trigger"}
        aria-expanded={open}
        aria-label="Settings"
        onClick={() => setOpen((v) => !v)}
      >
        {showIdentity ? (
          <>
            <span className="avatar" aria-hidden="true">{initial}</span>
            <span className="settings__who">
              <span className="settings__name">{user?.display_name ?? "You"}</span>
              <span className="settings__mail">{user?.email}</span>
            </span>
            <SlidersIcon size={18} />
          </>
        ) : (
          <SlidersIcon size={20} />
        )}
      </button>

      {open && (
        <div className="settings__panel" role="group" aria-label="Settings">
          <div className="settings__head">
            <span className="avatar avatar--lg" aria-hidden="true">{initial}</span>
            <div className="settings__who">
              <span className="settings__name">{user?.display_name ?? "You"}</span>
              <span className="settings__mail">{user?.email}</span>
            </div>
          </div>

          <div className="settings__row">
            <span className="eyebrow">Appearance</span>
            <div className="seg-toggle seg-toggle--fill" role="group" aria-label="Appearance">
              {THEME_OPTIONS.map((o) => (
                <button key={o.value} type="button" data-active={theme === o.value} onClick={() => setTheme(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__row">
            <span className="eyebrow">A good month shows in</span>
            <div className="seg-toggle seg-toggle--fill" role="group" aria-label="Gain colour">
              {CONVENTION_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  data-active={convention === o.value}
                  onClick={() => setConvention(o.value)}
                >
                  <span className="dot" data-tone={o.value === "eastern" ? "red" : "green"} aria-hidden="true" />
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {user?.main_currency_code && (
            <div className="settings__kv">
              <span>Main currency</span>
              <span className="mono">{user.main_currency_code}</span>
            </div>
          )}

          <button type="button" className="settings__logout" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogoutIcon size={18} />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
