import { useState } from "react";
import type { PublicUser } from "@app/shared";
import Avatar from "../Avatar.js";

export function formatMeetupTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function calendarHref(title: string, startsAt: string, place: string): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//InTouch//Meetup//EN",
    "BEGIN:VEVENT",
    `UID:${icsDate(start)}-${Math.abs(title.length * 31 + place.length)}@intouch`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcs(title || "Meetup")}`,
    `LOCATION:${escapeIcs(place)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

export default function MeetupCard({
  title,
  startsAt,
  place,
  note,
  attendees,
  attendeeCount,
  isGoing,
  busy,
  onToggle,
  tone = "light",
  isCancelled = false,
  canManage = false,
  onEdit,
  onCancel,
  reminderMinutes = null,
  onReminderChange,
}: {
  title: string;
  startsAt: string;
  place: string;
  note?: string;
  attendees: Pick<PublicUser, "id" | "username" | "avatarKey">[];
  attendeeCount: number;
  isGoing: boolean;
  busy?: boolean;
  onToggle: () => void;
  tone?: "light" | "dark";
  isCancelled?: boolean;
  canManage?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  reminderMinutes?: number | null;
  onReminderChange?: (minutes: number | null) => void;
}) {
  const [reminderOpen, setReminderOpen] = useState(false);
  const past = new Date(startsAt).getTime() < Date.now();
  const dark = tone === "dark";
  return (
    <div
      className={`w-64 max-w-full overflow-hidden rounded-2xl border text-left ${dark ? "border-white/25 bg-white/10 text-white backdrop-blur" : "border-gray-200 bg-white text-gray-900 shadow-sm"}`}
    >
      <div className={`flex items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${dark ? "bg-white/10 text-white/80" : "bg-gradient-to-r from-fuchsia-50 to-blue-50 text-fuchsia-700"}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M8 3v4M16 3v4M3.5 10h17" />
        </svg>
        <span className="flex-1">Meetup</span>
        {isCancelled && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-800">Cancelled</span>}
      </div>
      <div className="space-y-1 px-3 py-2.5">
        {title && <p className="text-sm font-semibold leading-snug">{title}</p>}
        <p className="text-sm">{formatMeetupTime(startsAt)}</p>
        <p className={`flex items-start gap-1 text-sm ${dark ? "text-white/80" : "text-gray-600"}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
            <circle cx="12" cy="9.5" r="2.5" />
          </svg>
          <span className="min-w-0 break-words">{place}</span>
        </p>
        {note && <p className={`whitespace-pre-wrap text-xs ${dark ? "text-white/70" : "text-gray-500"}`}>{note}</p>}
      </div>
      <div className="flex items-center gap-2 px-3 pb-3">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="flex -space-x-2">
            {attendees.slice(0, 4).map((person) => (
              <span key={person.id} className="rounded-full ring-2 ring-white">
                <Avatar avatarKey={person.avatarKey} username={person.username} size={22} />
              </span>
            ))}
          </div>
          <span className={`ml-2 truncate text-xs ${dark ? "text-white/80" : "text-gray-500"}`}>
            {attendeeCount === 0 ? "Be the first" : `${attendeeCount} going`}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy || past || isCancelled}
          aria-pressed={isGoing}
          className={`min-h-9 shrink-0 rounded-full px-3.5 text-xs font-semibold transition-[background-color,transform] active:scale-95 disabled:opacity-50 ${
            isGoing
              ? "bg-green-600 text-white hover:bg-green-700"
              : dark ? "bg-white text-black hover:bg-white/90" : "bg-black text-white hover:bg-gray-800"
          }`}
        >
          {isCancelled ? "Cancelled" : past ? "Ended" : isGoing ? "✓ I'm in" : "I'm in"}
        </button>
      </div>
      {!past && !isCancelled && (
        <a
          href={calendarHref(title, startsAt, place)}
          download="meetup.ics"
          className={`block border-t px-3 py-2 text-center text-[11px] font-medium ${dark ? "border-white/20 text-white/80 hover:bg-white/10" : "border-gray-100 text-blue-600 hover:bg-gray-50"}`}
        >
          Add to calendar
        </a>
      )}
      {!past && !isCancelled && onReminderChange && (
        <div className={`relative border-t px-3 py-2 ${dark ? "border-white/20" : "border-gray-100"}`}>
          <button
            type="button"
            onClick={() => setReminderOpen((open) => !open)}
            aria-expanded={reminderOpen}
            className={`flex w-full items-center justify-between gap-2 text-[11px] font-medium ${dark ? "text-white/80" : "text-gray-600"}`}
          >
            <span className="flex items-center gap-1.5">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {reminderMinutes === null ? "Set a private reminder" : `Reminder · ${reminderMinutes < 60 ? `${reminderMinutes} min` : reminderMinutes === 1440 ? "1 day" : `${reminderMinutes / 60} hr`} before`}
            </span>
            <span aria-hidden="true">{reminderOpen ? "⌃" : "⌄"}</span>
          </button>
          {reminderOpen && (
            <div className={`absolute bottom-full left-2 right-2 z-20 mb-1 overflow-hidden rounded-xl border shadow-lg ${dark ? "border-white/20 bg-gray-950 text-white" : "border-gray-200 bg-white text-gray-800"}`}>
              {[
                [null, "No reminder"],
                [5, "5 minutes before"],
                [15, "15 minutes before"],
                [60, "1 hour before"],
                [1440, "1 day before"],
              ].map(([minutes, label]) => (
                <button
                  key={String(minutes)}
                  type="button"
                  onClick={() => {
                    onReminderChange(minutes === null ? null : Number(minutes));
                    setReminderOpen(false);
                  }}
                  className={`flex min-h-10 w-full items-center justify-between px-3 text-left text-xs hover:bg-gray-100 ${dark ? "hover:bg-white/10" : ""}`}
                >
                  {label}
                  {reminderMinutes === minutes && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              <p className={`border-t px-3 py-2 text-[10px] leading-4 ${dark ? "border-white/10 text-white/55" : "border-gray-100 text-gray-500"}`}>
                Stored on this device. Shows a neutral reminder while InTouch is open or next time you return.
              </p>
            </div>
          )}
        </div>
      )}
      {canManage && !isCancelled && !past && (
        <div className={`flex gap-2 border-t px-3 py-2 ${dark ? "border-white/20" : "border-gray-100"}`}>
          <button type="button" onClick={onEdit} className={`min-h-8 flex-1 rounded-lg text-xs font-semibold ${dark ? "bg-white/10 text-white hover:bg-white/20" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
            Edit
          </button>
          <button type="button" onClick={onCancel} className={`min-h-8 flex-1 rounded-lg text-xs font-semibold ${dark ? "text-red-200 hover:bg-red-900/30" : "text-red-600 hover:bg-red-50"}`}>
            Cancel meetup
          </button>
        </div>
      )}
    </div>
  );
}
