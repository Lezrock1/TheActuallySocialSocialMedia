import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PublicUser } from "@app/shared";
import { apiFetch, ApiError } from "../lib/api.js";
import { registerDeviceEncryptionKey } from "../lib/encryptionRegistration.js";

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    username: string,
    password: string,
    inviteCode: string
  ) => Promise<void>;
  updateUser: (user: PublicUser | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ user: PublicUser }>("/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
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
    <AuthContext.Provider value={{ user, loading, login, register, updateUser: setUser, logout }}>
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
