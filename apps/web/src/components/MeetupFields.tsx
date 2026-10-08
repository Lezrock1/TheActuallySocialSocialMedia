import { useState } from "react";
import { input, btnPrimary } from "../lib/ui.js";
import Sheet from "./Sheet.js";

export interface MeetupDraft {
  title: string;
  // value of <input type="datetime-local">
  when: string;
  place: string;
  note: string;
}

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function defaultMeetupDraft(): MeetupDraft {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  return { title: "", when: toLocalInputValue(tomorrow), place: "", note: "" };
}

// Returns an error message or null when the draft is valid.
export function validateMeetupDraft(draft: MeetupDraft): string | null {
  if (!draft.place.trim()) return "Add a place for the meetup.";
  const time = new Date(draft.when).getTime();
  if (!Number.isFinite(time)) return "Pick a date and time.";
  if (time < Date.now()) return "Pick a time in the future.";
  return null;
}

export function MeetupFields({
  draft,
  onChange,
  withNote = true,
}: {
  draft: MeetupDraft;
  onChange: (draft: MeetupDraft) => void;
  withNote?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        What
        <input
          value={draft.title}
          maxLength={60}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="Coffee, board games, walk…"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        When
        <input
          type="datetime-local"
          value={draft.when}
          min={toLocalInputValue(new Date())}
          onChange={(event) => onChange({ ...draft, when: event.target.value })}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Where
        <input
          value={draft.place}
          maxLength={120}
          onChange={(event) => onChange({ ...draft, place: event.target.value })}
          placeholder="Café name, address or meeting point"
          className={input}
        />
      </label>
      {withNote && (
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Note (optional)
          <textarea
            value={draft.note}
            maxLength={200}
            rows={2}
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
            className={`${input} resize-none`}
          />
        </label>
      )}
    </div>
  );
}

export default function MeetupSheet({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: MeetupDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(defaultMeetupDraft);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    const problem = validateMeetupDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSubmit(draft);
      setDraft(defaultMeetupDraft());
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the meetup.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Propose a meetup"
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
          <button type="button" onClick={() => void submit()} disabled={sending} className={`${btnPrimary} w-full`}>
            {sending ? "Sending…" : "Send proposal"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs leading-5 text-gray-500">
        Everyone in this chat can tap “I'm in”. Date and place stay end-to-end encrypted.
      </p>
      <MeetupFields draft={draft} onChange={setDraft} />
    </Sheet>
  );
}
