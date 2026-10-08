import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export default function AppDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  pending = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 pb-[env(safe-area-inset-bottom)] backdrop-blur-[2px]" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className="menu-enter w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="app-dialog-title" className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-gray-600">{description}</p>}
        {children && <div className="mt-3">{children}</div>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="min-h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`min-h-10 rounded-xl px-3 text-sm font-semibold text-white disabled:opacity-50 ${danger ? "bg-red-600 hover:bg-red-700" : "bg-black hover:bg-gray-800"}`}
          >
            {pending ? "Working..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
