// Shared Tailwind class fragments so the app looks consistent everywhere.
export const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]";
export const activityList = "overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)]";
export const activityRow =
  "flex w-full min-w-0 items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition-[background-color,transform] duration-200 last:border-b-0 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#007AFF]";
export const input =
  "rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm placeholder:text-gray-400 transition-[border-color,box-shadow] duration-200 focus:border-[#007AFF] focus:outline-none focus:ring-4 focus:ring-[#007AFF]/10 disabled:bg-gray-50 disabled:text-gray-500";
export const btnPrimary =
  "rounded-xl bg-[#007AFF] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow,transform] duration-200 hover:bg-[#006BE0] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#007AFF]/20 disabled:cursor-not-allowed disabled:opacity-50";
export const btnSecondary =
  "rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-[background-color,border-color,transform] duration-200 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#007AFF]/10 disabled:cursor-not-allowed disabled:opacity-50";
export const btnDanger = "text-xs font-medium text-red-600 hover:underline";
export const pill = "rounded-full px-2.5 py-0.5 text-[11px] font-medium";

export function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}
