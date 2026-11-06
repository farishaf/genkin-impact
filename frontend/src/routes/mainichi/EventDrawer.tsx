import { fromKey, type PlannerEvent, type Routine } from "../../lib/planner";
import { Drawer } from "./parts";
import { EventEditor, NewEventForm } from "./EventPanel";

const shortDate = (key: string) => fromKey(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

interface CreateMode {
  date: string;
  routines: Routine[];
  /** Called with the new item. Keep the drawer mounted and switch `event` to it, so the dialog never unmounts between form and editor. */
  onCreated: (event: PlannerEvent) => void;
}

interface EventDrawerProps {
  /** The item to edit. Leave it out, with `create`, to show the new-item form. */
  event?: PlannerEvent;
  create?: CreateMode;
  onClose: () => void;
  /** After "Move to" changes the date. Optional: Today stays on its day, Calendar follows the item. */
  onMoved?: (date: string) => void;
}

/** The right-hand sheet for one run, workout or event. Shared by Calendar and Today. */
export function EventDrawer({ event, create, onClose, onMoved }: EventDrawerProps) {
  const title = event ? shortDate(event.date) : create ? `New item on ${shortDate(create.date)}` : "Item";
  return (
    <Drawer title={title} onClose={onClose}>
      {event ? (
        <EventEditor key={event.id} event={event} onClose={onClose} onMoved={onMoved ?? (() => undefined)} />
      ) : create ? (
        <NewEventForm key={create.date} date={create.date} routines={create.routines} onCancel={onClose} onCreated={create.onCreated} />
      ) : null}
    </Drawer>
  );
}
