import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

let socket: ReturnType<typeof io> | null = null;

// One shared socket for the whole app; auth is via the httpOnly cookie.
export function getSocket() {
  if (!socket) {
    socket = io(API_BASE, { withCredentials: true });
  }
  return socket;
}
