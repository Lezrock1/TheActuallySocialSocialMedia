import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const API = process.env.E2E_API ?? "http://localhost:4000";
export const PASSWORD = "Passw0rd!e2e";
export const USERS = ["leo", "mia", "noah", "ivy"];
const BOOTSTRAP = process.env.BOOTSTRAP_INVITE_CODE ?? "e2e-bootstrap-invite-code-0123456789abcdef";

export const email = (username) => `e2e-${username}@example.com`;

function authCookie(response) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("auth_token="));
  return cookie ? cookie.split(";")[0] : null;
}

async function call(path, { method = "GET", body, cookie, form } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response;
}

export async function login(username) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email(username), password: PASSWORD }),
  });
  return response.ok ? authCookie(response) : null;
}

async function register(username, inviteCode) {
  const response = await call("/auth/register", {
    method: "POST",
    body: { email: email(username), username, password: PASSWORD, inviteCode },
  });
  const cookie = authCookie(response);
  if (!cookie) throw new Error(`Could not register ${username}`);
  return cookie;
}

async function uploadImage(cookie) {
  const bytes = await readFile(new URL("../apps/web/public/apple-touch-icon.png", import.meta.url));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), "demo.png");
  const response = await call("/media", { method: "POST", cookie, form });
  return (await response.json()).key;
}

// Idempotent: creates the demo accounts once and fills them with content when the feed is empty.
async function seedConversations(sessions) {
  const existing = await (await call("/conversations", { cookie: sessions.leo })).json();
  if ((existing.conversations?.length ?? 0) > 0) return;
  await call("/conversations", { method: "POST", cookie: sessions.leo, body: { username: "mia" } });
  await call("/conversations", { method: "POST", cookie: sessions.noah, body: { username: "leo" } });
  await call("/conversations/group", {
    method: "POST",
    cookie: sessions.ivy,
    body: { name: "Weekend plans", usernames: ["leo", "mia", "noah"] },
  });
}

export async function seed() {
  const sessions = {};
  if (await login(USERS[0])) {
    for (const username of USERS) sessions[username] = await login(username);
    const feed = await (await call("/feed", { cookie: sessions.leo })).json();
    if ((feed.items?.length ?? 0) > 0) {
      await seedConversations(sessions);
      return;
    }
  } else {
    sessions[USERS[0]] = await register(USERS[0], BOOTSTRAP);
    for (const username of USERS.slice(1)) {
      const invite = await (await call("/invitations", { method: "POST", cookie: sessions[USERS[0]] })).json();
      sessions[username] = await register(username, invite.code);
    }
  }

  for (const from of USERS) {
    for (const to of USERS) {
      if (from !== to) await call(`/users/${to}/follow`, { method: "POST", cookie: sessions[from] });
    }
  }

  const imageKey = await uploadImage(sessions.mia);
  const miaPost = await (await call("/posts", {
    method: "POST",
    cookie: sessions.mia,
    body: { text: "Golden hour on the roof. Worth the climb.", imageKey, mediaType: "image" },
  })).json();
  await call("/posts", {
    method: "POST",
    cookie: sessions.noah,
    body: { text: "Anyone up for a quick run tomorrow morning?" },
  });
  await call("/posts", {
    method: "POST",
    cookie: sessions.ivy,
    body: { text: "New playlist is live. Tell me what to add." },
  });

  const postId = miaPost.post?.id ?? miaPost.id;
  if (postId) {
    await call(`/posts/${postId}/comments`, {
      method: "POST",
      cookie: sessions.noah,
      body: { text: "That light is unreal!" },
    });
    const leoImage = await uploadImage(sessions.leo);
    await call(`/posts/${postId}/comments`, {
      method: "POST",
      cookie: sessions.leo,
      body: { text: "Where is this?", imageKey: leoImage },
    });
  }
  await seedConversations(sessions);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await seed();
  console.log(`Demo data ready. Log in with ${email("leo")} / ${PASSWORD}`);
}
