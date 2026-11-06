import { useState } from "react";
import type { PlannerEvent } from "../../lib/planner";

/**
 * Resolves the open item from whichever lists are loaded. It keeps the last match while a refetch has no row for it yet
 * (a new month after "Move to", or a just-created item), so the drawer never blinks shut.
 * `remember` seeds the item before any list has it, e.g. right after creating it.
 */
export function useOpenEvent(id: string | null, sources: PlannerEvent[][]) {
  const [last, setLast] = useState<PlannerEvent>();
  const found = id ? sources.flat().find((e) => e.id === id) : undefined;
  if (found && found !== last) setLast(found);
  const event = found ?? (id && last?.id === id ? last : undefined);
  return { event, remember: setLast };
}
