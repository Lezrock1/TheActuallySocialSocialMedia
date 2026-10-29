import type { QueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "@app/shared";
import { apiFetch } from "./api.js";

// Dynamic imports share the chunks that React.lazy uses in App.tsx, so warming them removes the loading flash on first visit.
const chunkLoaders: Record<string, () => Promise<unknown>> = {
  "/": () => import("../pages/FeedPage.js"),
  "/snaps": () => import("../pages/SnapsPage.js"),
  "/dms": () => import("../pages/DMsPage.js"),
  "/notifications": () => import("../pages/NotificationsPage.js"),
  "/people": () => import("../pages/PeopleSearchPage.js"),
  "/circles": () => import("../pages/CirclesPage.js"),
  "/profile": () => import("../pages/ProfilePage.js"),
  "/post": () => import("../pages/PostThreadPage.js"),
};

export function preloadRoute(path: string): void {
  void chunkLoaders[path]?.().catch(() => undefined);
}

export function preloadMainRoutes(): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const run = () => { for (const path of Object.keys(chunkLoaders)) preloadRoute(path); };
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle.call(window, run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}

// Warms what the destination of a tap needs, so the page opens with its content.
export function warmTab(queryClient: QueryClient, path: string): void {
  preloadRoute(path);
  if (path === "/dms") {
    void queryClient.prefetchQuery({
      queryKey: ["conversations"],
      queryFn: async () => (await apiFetch<{ conversations: ConversationSummary[] }>("/conversations")).conversations,
      staleTime: 15_000,
    });
  }
}

export function warmProfile(queryClient: QueryClient, username: string): void {
  preloadRoute("/profile");
  void queryClient.prefetchQuery({
    queryKey: ["profile", username],
    queryFn: async () => (await apiFetch<{ profile: unknown }>(`/users/${username}`)).profile,
    staleTime: 15_000,
  });
}
