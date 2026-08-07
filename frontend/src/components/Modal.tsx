import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { CloseIcon } from "./TxnIcons";

gsap.registerPlugin(useGSAP);

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useGSAP(
    () => {
      if (!open || !panelRef.current) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const isMobile = window.matchMedia("(max-width: 60rem)").matches;
      gsap.from(panelRef.current.parentElement, { autoAlpha: 0, duration: reduced ? 0.1 : 0.18, ease: "power2.out" });
      gsap.from(
        panelRef.current,
        isMobile
          ? { y: reduced ? 0 : "100%", duration: reduced ? 0.1 : 0.26, ease: "power3.out" }
          : { autoAlpha: 0, y: reduced ? 0 : 16, duration: reduced ? 0.1 : 0.2, ease: "power2.out" }
      );
    },
    { dependencies: [open] }
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="modal-panel__head">
            <span className="modal-panel__title">{title}</span>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="modal-panel__body">{children}</div>
      </div>
    </div>
  );
}
