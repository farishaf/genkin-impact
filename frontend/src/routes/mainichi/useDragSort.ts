import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export const moveIn = <T,>(arr: T[], from: number, to: number) => {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
};

/** Pointer-based drag to reorder (mouse and touch). Reorders live as the pointer crosses item midpoints. */
export function useDragSort(ids: string[], onMove: (from: number, to: number) => void) {
  const els = useRef(new Map<string, HTMLElement>());
  const latest = useRef({ ids, onMove });
  useLayoutEffect(() => {
    latest.current = { ids, onMove };
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const itemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };
  const handleProps = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(id);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (dragging !== id) return;
      const { ids: order, onMove: move } = latest.current;
      const from = order.indexOf(id);
      const to = order.filter((o) => o !== id).filter((o) => {
        const r = els.current.get(o)?.getBoundingClientRect();
        return r && r.top + r.height / 2 < e.clientY;
      }).length;
      if (from !== -1 && to !== from) move(from, to);
    },
    onPointerUp: () => setDragging(null),
    onPointerCancel: () => setDragging(null),
  });
  return { itemRef, handleProps, dragging };
}
