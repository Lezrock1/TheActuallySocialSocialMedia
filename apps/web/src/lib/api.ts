const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function formatApiError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (!error || typeof error !== "object") return fallback;

  const details = error as Record<string, unknown>;
  if (typeof details.message === "string" && details.message.trim()) {
    return details.message;
  }

  const formErrors = Array.isArray(details.formErrors)
    ? details.formErrors.filter((message): message is string => typeof message === "string")
    : [];
  const fieldErrors = details.fieldErrors && typeof details.fieldErrors === "object"
    ? Object.entries(details.fieldErrors as Record<string, unknown>).flatMap(([field, messages]) =>
        Array.isArray(messages)
          ? messages
              .filter((message): message is string => typeof message === "string")
              .map((message) => `${field}: ${message}`)
          : []
      )
    : [];
  const messages = [...formErrors, ...fieldErrors];
  return messages.length ? messages.join("; ") : fallback;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      // only send a JSON content-type when there's actually a body,
      // otherwise Fastify rejects empty bodies sent as application/json
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(formatApiError(body.error, res.statusText || "Request failed"), res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
