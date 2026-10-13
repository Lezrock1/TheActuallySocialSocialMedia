import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MOMENT_WINDOW_SECONDS } from "@app/shared";
import type { MomentSummary } from "@app/shared";
import { apiFetch } from "./api.js";
import { useAuth } from "../auth/AuthContext.js";

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Polls today's Moment and keeps a server-synced countdown ticking once a second.
export function useMoment() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["moment", "today"],
    queryFn: () => apiFetch<MomentSummary>("/moments/today"),
    enabled: !!user,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
  const summary = query.data;
  const [now, setNow] = useState(() => Date.now());

  const active = summary?.status === "open" || summary?.status === "waiting";
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  const offset = summary ? Date.parse(summary.serverNow) - query.dataUpdatedAt : 0;
  const windowEnd = summary?.windowEndsAt ? Date.parse(summary.windowEndsAt) : null;
  const remainingMs = windowEnd === null ? 0 : windowEnd - (now + offset);
  const status = summary?.status === "open" && remainingMs <= 0 ? "late" : summary?.status ?? "none";

  return {
    summary,
    status,
    remainingMs: Math.max(0, remainingMs),
    progress: Math.min(1, Math.max(0, remainingMs / (MOMENT_WINDOW_SECONDS * 1000))),
    isLoading: query.isLoading,
  };
}
