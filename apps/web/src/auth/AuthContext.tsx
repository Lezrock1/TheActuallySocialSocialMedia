import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PublicUser } from "@app/shared";
import { apiFetch, ApiError } from "../lib/api.js";
import { registerDeviceEncryptionKey } from "../lib/encryptionRegistration.js";

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  bootError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    username: string,
    password: string,
    inviteCode: string
  ) => Promise<void>;
  updateUser: (user: PublicUser | null) => void;
  logout: () => Promise<void>;
  retryBootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  async function bootstrapSession(): Promise<void> {
    setLoading(true);
    setBootError(null);
    try {
      const res = await apiFetch<{ user: PublicUser }>("/auth/me");
      setUser(res.user);
    } catch (error) {
      setUser(null);
      if (!(error instanceof ApiError && error.status === 401)) {
        setBootError("InTouch cannot reach the server right now.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void bootstrapSession();
  }, []);

  useEffect(() => {
    if (user) {
      void registerDeviceEncryptionKey(user.id).catch(() => undefined);
    }
  }, [user]);

  async function login(email: string, password: string) {
    const res = await apiFetch<{ user: PublicUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(res.user);
  }

  async function register(
    email: string,
    username: string,
    password: string,
    inviteCode: string
  ) {
    const res = await apiFetch<{ user: PublicUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password, inviteCode }),
    });
    setUser(res.user);
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, bootError, login, register, updateUser: setUser, logout, retryBootstrap: bootstrapSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
