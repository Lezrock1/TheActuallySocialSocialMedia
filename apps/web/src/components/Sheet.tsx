import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

const CLOSE_ANIMATION_MS = 190;

// Bottom sheet on phones (drag the top down to dismiss), centered dialog on larger screens.
export default function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  tall = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  tall?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startAt: number; dy: number } | null>(null);
  const timerRef = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onCloseRef.current();
      // A parent that keeps the sheet open (for example while saving) gets it back.
      closingRef.current = false;
      setClosing(false);
    }, CLOSE_ANIMATION_MS);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  function onDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!window.matchMedia("(max-width: 639px)").matches || (event.target as Element).closest("button")) return;
    dragRef.current = { startY: event.clientY, startAt: performance.now(), dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !sheetRef.current) return;
    drag.dy = Math.max(0, event.clientY - drag.startY);
    sheetRef.current.style.transition = "none";
    sheetRef.current.style.transform = `translateY(${drag.dy}px)`;
    if (backdropRef.current) backdropRef.current.style.opacity = String(1 - Math.min(1, drag.dy / 420));
  }

  function onDragEnd() {
    const drag = dragRef.current;
    dragRef.current = null;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    const velocity = drag.dy / Math.max(1, performance.now() - drag.startAt);
    if (drag.dy > 110 || (velocity > 0.6 && drag.dy > 30)) {
      requestClose();
      return;
    }
    sheet.style.transition = "transform 240ms cubic-bezier(0.2, 0.9, 0.3, 1.1)";
    sheet.style.transform = "";
    if (backdropRef.current) backdropRef.current.style.opacity = "";
    window.setTimeout(() => { sheet.style.transition = ""; }, 260);
  }

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className={`${closing ? "sheet-backdrop-exit" : "sheet-backdrop-enter"} fixed inset-0 z-[70] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:px-4`}
      onClick={requestClose}
    >
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`${closing ? "sheet-exit" : "sheet-enter"} flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl sm:rounded-3xl ${tall ? "max-h-[88vh]" : "max-h-[80vh]"}`}
      >
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="touch-none sm:touch-auto"
        >
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300 sm:hidden" />
          <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-4">
            <h2 className="min-w-0 truncate text-base font-semibold text-gray-900">{title}</h2>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-gray-500 transition-colors hover:bg-gray-100"
            >
              ×
            </button>
          </header>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <footer
            className="border-t border-gray-100 px-5 pt-3"
            style={{ paddingBottom: "max(0.9rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
