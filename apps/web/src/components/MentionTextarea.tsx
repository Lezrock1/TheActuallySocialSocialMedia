import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PublicUser } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import Avatar from "./Avatar.js";

const MENTION_AT_CARET = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{0,30})$/;

interface ActiveMention {
  query: string;
  start: number;
}

function findActiveMention(element: HTMLTextAreaElement): ActiveMention | null {
  if (element.selectionStart !== element.selectionEnd) return null;
  const match = MENTION_AT_CARET.exec(element.value.slice(0, element.selectionStart));
  return match ? { query: match[1], start: element.selectionStart - match[1].length - 1 } : null;
}

// While the next keystroke is still loading, the previous list is narrowed and re-ordered to what is typed now,
// so Enter can never pick someone who no longer matches.
function matchTyped(users: PublicUser[], query: string): PublicUser[] {
  const needle = query.toLowerCase();
  if (!needle) return users;
  const score = (user: PublicUser): number => {
    const username = user.username.toLowerCase();
    const name = (user.displayName ?? "").toLowerCase();
    if (username === needle) return 0;
    if (username.startsWith(needle)) return 1;
    if (name.split(/\s+/).some((word) => word.startsWith(needle))) return 2;
    return username.includes(needle) || name.includes(needle) ? 3 : 9;
  };
  return users.filter((user) => score(user) < 9).sort((a, b) => score(a) - score(b));
}

// Lets React see a programmatic change as if the user had typed it.
function setNativeValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

// Drop-in textarea that suggests people while an @mention is being typed.
const MentionTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function MentionTextarea({ onChange, onSelect, onKeyDown, onBlur, ...rest }, forwardedRef) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement);
    const listId = useId();
    const dismissedStartRef = useRef<number | null>(null);
    const [mention, setMention] = useState<ActiveMention | null>(null);
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [selected, setSelected] = useState(0);
    const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

    useEffect(() => {
      if (!mention) return;
      const timer = window.setTimeout(() => setDebouncedQuery(mention.query), mention.query ? 120 : 0);
      return () => window.clearTimeout(timer);
    }, [mention?.query]);

    const { data } = useQuery({
      queryKey: ["mention-suggestions", debouncedQuery],
      queryFn: () => apiFetch<{ users: PublicUser[] }>(`/mentions/suggestions?q=${encodeURIComponent(debouncedQuery)}`),
      enabled: !!mention,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    });
    const users = mention ? matchTyped(data?.users ?? [], mention.query) : [];
    const open = users.length > 0;

    useEffect(() => setSelected(0), [debouncedQuery, mention?.start]);

    useEffect(() => {
      if (!open) return;
      function place() {
        const element = textareaRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const viewport = window.visualViewport;
        const spaceBelow = (viewport ? viewport.offsetTop + viewport.height : window.innerHeight) - rect.bottom;
        setBox(spaceBelow >= 220
          ? { left: rect.left, width: rect.width, top: rect.bottom + 4 }
          : { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 4 });
      }
      place();
      window.addEventListener("scroll", place, true);
      window.addEventListener("resize", place);
      window.visualViewport?.addEventListener("resize", place);
      return () => {
        window.removeEventListener("scroll", place, true);
        window.removeEventListener("resize", place);
        window.visualViewport?.removeEventListener("resize", place);
      };
    }, [open, users.length]);

    function refresh() {
      const element = textareaRef.current;
      const next = element ? findActiveMention(element) : null;
      if (!next) dismissedStartRef.current = null;
      setMention(next && next.start !== dismissedStartRef.current ? next : null);
    }

    function pick(user: PublicUser) {
      const element = textareaRef.current;
      if (!element || !mention) return;
      const tail = /^[A-Za-z0-9_]*/.exec(element.value.slice(element.selectionStart))?.[0] ?? "";
      const before = element.value.slice(0, mention.start);
      const after = element.value.slice(element.selectionStart + tail.length);
      const caret = before.length + user.username.length + 2;
      setNativeValue(element, `${before}@${user.username} ${after}`);
      element.focus();
      element.setSelectionRange(caret, caret);
      setMention(null);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (open && !event.nativeEvent.isComposing) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : users.length - 1)) % users.length);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          pick(users[selected] ?? users[0]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          // Keeps a surrounding sheet or dialog from closing with the list.
          event.nativeEvent.stopPropagation();
          dismissedStartRef.current = mention?.start ?? null;
          setMention(null);
          return;
        }
      }
      onKeyDown?.(event);
    }

    return (
      <>
        <textarea
          {...rest}
          ref={textareaRef}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          onChange={(event) => { onChange?.(event); refresh(); }}
          onSelect={(event) => { onSelect?.(event); refresh(); }}
          onKeyDown={handleKeyDown}
          onBlur={(event) => { onBlur?.(event); window.setTimeout(() => setMention(null), 150); }}
        />
        {open && box && createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-label="Mention suggestions"
            style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom }}
            className="content-enter fixed z-[90] max-h-60 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          >
            {users.map((user, index) => (
              <li key={user.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  // Keeps the keyboard and caret in the text field while choosing.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => pick(user)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${index === selected ? "bg-gray-100" : ""}`}
                >
                  <Avatar avatarKey={user.avatarKey} username={user.username} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">@{user.username}</span>
                    {user.displayName && <span className="block truncate text-xs text-gray-500">{user.displayName}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
      </>
    );
  }
);

export default MentionTextarea;
