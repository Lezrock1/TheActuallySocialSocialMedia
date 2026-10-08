import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { deliverDueMeetupReminders } from "../lib/localMeetupReminders.js";

export default function LocalMeetupReminderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    let running = false;
    const check = () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      void deliverDueMeetupReminders(user.id)
        .catch(() => undefined)
        .finally(() => { running = false; });
    };
    check();
    const interval = window.setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, [user]);

  return children;
}
