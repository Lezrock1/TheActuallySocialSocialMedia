import { useEffect, useState } from "react";
import type { PublicUser } from "@app/shared";
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

export function meetupToDraft(meetup: {
  title: string;
  startsAt: string;
  place: string;
  note: string;
}): MeetupDraft {
  const start = new Date(meetup.startsAt);
  return {
    title: meetup.title,
    when: Number.isNaN(start.getTime()) ? defaultMeetupDraft().when : toLocalInputValue(start),
    place: meetup.place,
    note: meetup.note,
  };
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
  initialDraft,
  contacts = [],
  mode = "create",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: MeetupDraft, inviteeUserIds?: string[]) => Promise<void>;
  initialDraft?: MeetupDraft;
  contacts?: PublicUser[];
  mode?: "create" | "edit";
}) {
  const [draft, setDraft] = useState(() => initialDraft ?? defaultMeetupDraft());
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const initialTitle = initialDraft?.title;
  const initialWhen = initialDraft?.when;
  const initialPlace = initialDraft?.place;
  const initialNote = initialDraft?.note;

  useEffect(() => {
    if (!open) return;
    setDraft(initialTitle !== undefined && initialWhen !== undefined && initialPlace !== undefined && initialNote !== undefined
      ? { title: initialTitle, when: initialWhen, place: initialPlace, note: initialNote }
      : defaultMeetupDraft());
    setSelectedContactIds([]);
    setError(null);
  }, [initialTitle, initialWhen, initialPlace, initialNote, open]);

  async function submit() {
    const problem = validateMeetupDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSubmit(draft, selectedContactIds);
      setDraft(defaultMeetupDraft());
      setSelectedContactIds([]);
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
      title={mode === "edit" ? "Edit meetup" : "Propose a meetup"}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
          <button type="button" onClick={() => void submit()} disabled={sending} className={`${btnPrimary} w-full`}>
            {sending ? "Saving…" : mode === "edit" ? "Save changes" : "Send proposal"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs leading-5 text-gray-500">
        {contacts.length > 0
          ? "Selected contacts and everyone in this chat will share the meetup and RSVP list."
          : "Everyone in this chat can tap “I'm in”. Date and place stay end-to-end encrypted."}
      </p>
      <MeetupFields draft={draft} onChange={setDraft} />
      {contacts.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-semibold text-gray-700">Add contacts</legend>
          <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-200">
            {contacts.map((contact) => {
              const checked = selectedContactIds.includes(contact.id);
              return (
                <label key={contact.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-gray-100 px-3 last:border-b-0 hover:bg-gray-50">
                  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                    {contact.username.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{contact.displayName || `@${contact.username}`}</span>
                  <input
                    type="checkbox"
                    aria-label={`Invite @${contact.username}`}
                    checked={checked}
                    onChange={() => setSelectedContactIds((current) => checked
                      ? current.filter((id) => id !== contact.id)
                      : [...current, contact.id])}
                    className="h-4 w-4 accent-emerald-700"
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </Sheet>
  );
}
