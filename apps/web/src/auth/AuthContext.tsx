import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PublicUser } from "@app/shared";
import { apiFetch, ApiError } from "../lib/api.js";
import { registerDeviceEncryptionKey } from "../lib/encryptionRegistration.js";
import { preloadMediaKeys } from "../lib/upload.js";

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

  const bootstrapSession = useCallback(async (): Promise<void> => {
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
  }, []);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    if (user) {
      void registerDeviceEncryptionKey(user.id).catch(() => undefined);
      preloadMediaKeys([user.avatarKey], { priority: "high" });
    }
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ user: PublicUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(res.user);
  }, []);

  const register = useCallback(async (
    email: string,
    username: string,
    password: string,
    inviteCode: string
  ) => {
    const res = await apiFetch<{ user: PublicUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password, inviteCode }),
    });
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    bootError,
    login,
    register,
    updateUser: setUser,
    logout,
    retryBootstrap: bootstrapSession,
  }), [bootError, bootstrapSession, loading, login, logout, register, user]);

  return (
    <AuthContext.Provider value={value}>
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
