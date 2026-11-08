import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ENTER, reducedMotion } from "../lib/motion";

gsap.registerPlugin(useGSAP);

interface DialogOptions {
  title: string;
  body?: string;
  /** A verb for what pressing it does: "Delete", "Save". */
  confirmLabel: string;
  danger?: boolean;
  /** Turns the dialog into a one-field prompt. */
  input?: { label: string; placeholder?: string };
}

/** Native <dialog>: focus trap, Esc and top layer for free. Cancel sits first, so it holds focus by default. */
// eslint-disable-next-line react-refresh/only-export-components -- private component, mounted in its own root; fast refresh doesn't apply.
function Dialog({ title, body, confirmLabel, danger, input, onDone }: DialogOptions & { onDone: (value: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  const [text, setText] = useState("");
  const [closing, setClosing] = useState(false);

  useGSAP(() => {
    ref.current!.showModal();
    // The field when prompting, otherwise Cancel: Enter never deletes by accident.
    ref.current!.querySelector<HTMLElement>("input, button")?.focus();
    if (reducedMotion()) return;
    // opacity, not autoAlpha: visibility:hidden would drop the focus set above.
    gsap.from(ref.current, { opacity: 0, y: 8, scale: 0.96, ...ENTER });
  });

  // Not contextSafe: the root unmounts only from onComplete, so the tween never outlives the dialog.
  function finish(value: string | null) {
    if (closing) return;
    setClosing(true);
    if (reducedMotion()) return onDone(value);
    gsap.to(ref.current, { opacity: 0, scale: 0.98, duration: 0.12, ease: "power2.in", onComplete: () => onDone(value) });
  }

  return (
    <dialog
      ref={ref}
      className={`mi-confirm${closing ? " is-closing" : ""}`}
      aria-labelledby="mi-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        finish(null);
      }}
      onPointerDown={(e) => (downOnBackdrop.current = e.target === ref.current)}
      onClick={(e) => downOnBackdrop.current && e.target === ref.current && finish(null)}
    >
      <form
        className="mi-confirm__form"
        onSubmit={(e) => {
          e.preventDefault();
          finish(input ? text.trim() : "");
        }}
      >
        <h2 id="mi-confirm-title" className="mi-confirm__title">{title}</h2>
        {body && <p className="mi-confirm__body">{body}</p>}
        {input && (
          <label className="field mi-confirm__field">
            <span>{input.label}</span>
            <input value={text} placeholder={input.placeholder} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        <div className="mi-confirm__actions">
          <button type="button" className="btn btn--outline" onClick={() => finish(null)}>Cancel</button>
          <button type="submit" className={`btn ${danger ? "btn--danger" : "btn--primary"}`} disabled={!!input && !text.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ponytail: one throwaway React root per dialog keeps call sites a single `await`; it gets no app context, so the dialog takes plain props only.
function open(options: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const done = (value: string | null) =>
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        resolve(value);
      });
    root.render(<Dialog {...options} onDone={done} />);
  });
}

/** Resolves true when the user confirms. Esc, Cancel and a backdrop press resolve false. */
export const confirmDialog = (options: Omit<DialogOptions, "input">) => open(options).then((v) => v !== null);

/** Resolves the trimmed text, or null when dismissed. */
export const promptDialog = (options: DialogOptions & { input: NonNullable<DialogOptions["input"]> }) => open(options);
