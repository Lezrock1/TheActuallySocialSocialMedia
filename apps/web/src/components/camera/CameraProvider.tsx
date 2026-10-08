import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.js";

const CameraStudio = lazy(() => import("./CameraStudio.js"));

interface CameraContextValue {
  open: () => void;
}

const CameraContext = createContext<CameraContextValue>({ open: () => undefined });

export function useCamera(): CameraContextValue {
  return useContext(CameraContext);
}

// Mounts the camera above every page so the magenta button opens it instantly, without a route change.
export function CameraProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const openCamera = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open: openCamera }), [openCamera]);

  useEffect(() => {
    if (!user) return;
    // Warm the chunk while the browser is idle so the first tap is instant.
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500));
    idle(() => { void import("./CameraStudio.js"); });
  }, [user]);

  // Older links and push targets still use /snaps?camera=1.
  useEffect(() => {
    if (!user || new URLSearchParams(location.search).get("camera") !== "1") return;
    setOpen(true);
    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate, user]);

  return (
    <CameraContext.Provider value={value}>
      {children}
      {open && user && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
          <CameraStudio onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </CameraContext.Provider>
  );
}
