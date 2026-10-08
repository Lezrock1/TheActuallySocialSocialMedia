import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import "./index.css";
import { initializeTheme } from "./lib/theme.js";

initializeTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function primeApiConnection(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const apiBase = import.meta.env.VITE_API_BASE;
  if (!apiBase) return;

  let apiOrigin: string;
  try {
    apiOrigin = new URL(apiBase, window.location.href).origin;
  } catch {
    return;
  }

  if (apiOrigin === window.location.origin) return;

  const rels: Array<["dns-prefetch" | "preconnect", string | null]> = [
    ["dns-prefetch", null],
    ["preconnect", "use-credentials"],
  ];

  rels.forEach(([rel, crossOrigin]) => {
    const existing = document.head.querySelector(`link[rel=\"${rel}\"][href=\"${apiOrigin}\"]`);
    if (existing) return;
    const link = document.createElement("link");
    link.rel = rel;
    link.href = apiOrigin;
    if (crossOrigin) {
      link.crossOrigin = crossOrigin;
    }
    document.head.append(link);
  });
}

primeApiConnection();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
