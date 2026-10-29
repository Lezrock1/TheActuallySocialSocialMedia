import type { ReactNode } from "react";
import { btnSecondary } from "../lib/ui.js";

export function EmptyState({ icon, children, hint }: { icon: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="content-enter flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-2xl">{icon}</span>
      <p className="text-sm text-gray-500">{children}</p>
      {hint && <p className="max-w-xs text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export function ErrorState({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="content-enter flex flex-col items-center gap-3 px-4 py-8 text-center">
      <p className="text-sm text-red-600">{children}</p>
      {onRetry && <button type="button" onClick={onRetry} className={btnSecondary}>Retry</button>}
    </div>
  );
}
