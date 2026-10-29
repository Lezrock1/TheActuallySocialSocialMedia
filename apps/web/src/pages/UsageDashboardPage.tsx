import { useQuery } from "@tanstack/react-query";
import type { PublicUsageMetrics, UsageMetricCounts } from "@app/shared";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api.js";

const ACTIVITY_ROWS: Array<{ key: keyof UsageMetricCounts; label: string }> = [
  { key: "users", label: "New users" },
  { key: "posts", label: "Posts" },
  { key: "stories", label: "Stories" },
  { key: "moments", label: "Moments" },
  { key: "snaps", label: "Snaps" },
  { key: "messages", label: "Messages" },
  { key: "comments", label: "Comments" },
  { key: "follows", label: "New follows" },
];

async function fetchUsageMetrics(): Promise<PublicUsageMetrics> {
  return apiFetch<PublicUsageMetrics>("/public/usage-metrics");
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export default function UsageDashboardPage() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["public-usage-metrics"],
    queryFn: fetchUsageMetrics,
    refetchInterval: 60_000,
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-8 flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <Link to="/" className="flex items-center gap-2 text-sm font-bold text-gray-900 transition-colors hover:text-emerald-700">
          <img src="/icon-192.png" alt="" aria-hidden="true" width={32} height={32} className="h-8 w-8 rounded-lg" />
          InTouch
        </Link>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800">Public dashboard</span>
      </header>

      <section aria-labelledby="dashboard-title" className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Community activity</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 id="dashboard-title" className="text-3xl font-bold leading-tight tracking-normal text-gray-950 sm:text-4xl">InTouch in numbers</h1>
          {data && <p className="text-xs text-gray-500">Updated {formatTimestamp(data.asOf)}</p>}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          Anonymous totals across the community. No usernames, message contents, or individual activity are shown.
        </p>
      </section>

      {data && (
        <p className="mb-5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-600">
          Anonymous counting began {formatTimestamp(data.trackingSince)}. Earlier activity is not included; Stories, Snaps, and Moments may also have expired.
        </p>
      )}

      <section aria-label="Activity totals" className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,64px))] items-end gap-2 border-b border-gray-200 bg-gray-50 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,120px)] sm:px-6">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Activity</span>
          <span className="text-right text-[10px] font-semibold leading-4 text-gray-600">Last<br className="sm:hidden" /> 24 hours</span>
          <span className="text-right text-[10px] font-semibold leading-4 text-gray-600">Last 7 days</span>
          <span className="text-right text-[10px] font-semibold leading-4 text-gray-600" title="Since recording began">Total</span>
        </div>

        {isPending && ACTIVITY_ROWS.map(({ key, label }) => (
          <div key={key} aria-hidden="true" className="grid min-h-14 grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,64px))] items-center gap-2 border-b border-gray-100 px-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(3,120px)] sm:px-6">
            <span className="h-3 w-full max-w-28 skeleton block text-transparent">{label}</span>
            <span className="skeleton ml-auto block h-5 w-10" />
            <span className="skeleton ml-auto block h-5 w-10" />
            <span className="skeleton ml-auto block h-5 w-10" />
          </div>
        ))}

        {isError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
            <p className="text-sm text-gray-600">Usage totals are temporarily unavailable.</p>
            <button type="button" onClick={() => void refetch()} className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">Retry</button>
          </div>
        )}

        {data && ACTIVITY_ROWS.map(({ key, label }) => (
          <div key={key} className="grid min-h-14 grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,64px))] items-center gap-2 border-b border-gray-100 px-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(3,120px)] sm:px-6">
            <span className="text-sm font-medium text-gray-800 [overflow-wrap:anywhere]">{label}</span>
            <span className="text-right font-mono text-sm tabular-nums text-gray-700">{formatCount(data.last24Hours[key])}</span>
            <span className="text-right font-mono text-sm font-semibold tabular-nums text-emerald-800">{formatCount(data.last7Days[key])}</span>
            <span className="text-right font-mono text-sm font-semibold tabular-nums text-gray-900">{formatCount(data.total[key])}</span>
          </div>
        ))}
      </section>

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <span>Counts are aggregated in 5-minute intervals and refreshed every minute.</span>
        <span>UTC · No individual records are retained for this dashboard.</span>
      </footer>
    </main>
  );
}
