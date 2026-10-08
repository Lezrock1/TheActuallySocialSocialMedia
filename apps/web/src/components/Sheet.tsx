import { useEffect } from "react";
import type { ReactNode } from "react";

// Bottom sheet on phones, centered dialog on larger screens.
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
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:px-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`sheet-enter flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl sm:rounded-3xl ${tall ? "max-h-[88vh]" : "max-h-[80vh]"}`}
      >
        <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 className="min-w-0 truncate text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-gray-500 transition-colors hover:bg-gray-100"
          >
            ×
          </button>
        </header>
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
