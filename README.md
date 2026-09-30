# Interactive Social Media

Open-source social media: text/image posts, stories, snaps, DMs — **strictly chronological feed, no ranking algorithm, no ads**, with a freely choosable FactCheck/Explain/Ask AI (bring your own API keys, including local Ollama models).

## Purpose & Audience

A social media prototype for anyone who wants the strengths of Twitter (threads, replies), Instagram (stories, profiles), and Snapchat (snaps) combined — without an engagement-optimized algorithm, without ads, with self-directed, freely choosable AI assistance for putting posts into context. Intended for developers who want to experiment locally, self-host, or contribute. **Not a finished, production-ready product** — see [Open Items](#open-items).

## Features

- Chronological feed (no ranking algorithm) with a "you're all caught up" marker
- Text/image posts, reply threads, comments
- Stories (24h) and snaps (view-once) with "close friends" visibility
- Direct messages including group chats, realtime via Socket.io
- Profiles (bio, avatar, own posts)
- Moderation: block, report
- Freely choosable FactCheck/Explain/Ask AI: bring your own provider configuration (OpenAI-compatible APIs including local Ollama, Anthropic), with an opt-in FactCheck transparency log

## Status

Core MVP features are implemented and manually tested (see above). There are **no automated tests** — `vitest` is set up as a devDependency in `apps/api`, but no test files exist yet. There is **no CI pipeline**.

See [Open Items](#open-items) for known limitations and next steps.

## Architecture

- `apps/api` — Fastify + TypeScript + Prisma + PostgreSQL + S3-compatible storage (SeaweedFS)
- `apps/web` — React + Vite + TypeScript + Tailwind
- `packages/shared` — shared types/Zod schemas

```
code/
├── apps/
│   ├── api/    # Fastify backend (REST + Socket.io), Prisma schema/migrations
│   └── web/    # React frontend (Vite)
├── packages/
│   └── shared/ # shared TypeScript types and Zod validation schemas
├── docker-compose.yml  # local dev infrastructure (Postgres, SeaweedFS)
└── pnpm-workspace.yaml
```

Core principle: the feed is strictly `ORDER BY created_at DESC` — there is no ranking field in the schema. No ad entities, no re-engagement notifications.

**Storage note:** `minio/minio` is no longer pullable anonymously from Docker Hub/Quay (MinIO restricted distribution after their AGPL re-licensing). [SeaweedFS](https://github.com/seaweedfs/seaweedfs) is used locally instead as an S3-compatible object store (`docker-compose.yml`, service `storage`, port 8333).

## Prerequisites

Tested with:
- Node.js 20.15.1 (requires >= 20, see the `engines` field in `apps/api/package.json`)
- pnpm 12.8.1 (other 9.x/12.x versions should also work)
- Docker 29.x (for Postgres + SeaweedFS locally)

If `corepack`/`npx pnpm` fails with a signature error: `curl -fsSL https://get.pnpm.io/install.sh | sh -` installs pnpm via the official installer instead of corepack.

## Installation & Quickstart

```bash
# Start infrastructure (Postgres + SeaweedFS S3 gateway)
docker compose up -d

# Install dependencies
pnpm install

# Create .env files (see "Configuration" below for the values)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Apply the DB schema
cd apps/api && pnpm prisma:migrate

# Start the API (terminal 1, from the project root)
pnpm dev:api

# Start the web app (terminal 2, from the project root)
pnpm dev:web
```

Web app: http://localhost:5173, API: http://localhost:4000

These steps were run repeatedly during development and work with the versions listed above.

## Configuration

Both apps load their configuration from `.env` files (see `apps/api/.env.example` and `apps/web/.env.example`). **These files only contain placeholders, no real secrets.**

`apps/api/.env`:

| Variable | Purpose | Example/placeholder |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://app:app@localhost:5432/app` (dev default from `docker-compose.yml`) |
| `JWT_SECRET` | Signing key for auth cookies | **Must be replaced with a long random string before any real deployment** |
| `AI_KEY_ENCRYPTION_SECRET` | Key used to encrypt stored AI API keys (AES-256-GCM) | **Must be replaced before any real deployment** |
| `PORT` | API port | `4000` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |
| `NODE_ENV` | Environment | `development` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage (SeaweedFS in the dev setup, without real auth) | see `.env.example` |

`apps/web/.env`:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE` | Base URL of the API the frontend talks to |

## Usage

After starting the app: register at `/register`, log in, post, follow other users (input field in the feed), and configure your own FactCheck/Explain/Ask AI provider under "FactCheck-KI" (e.g. a local Ollama instance at `http://localhost:11434/v1`).

## Tests, Typecheck & Build

```bash
# TypeScript type-checking per package
pnpm --filter @app/shared typecheck
pnpm --filter @app/api typecheck
pnpm --filter @app/web typecheck

# Production build
pnpm build
```

There are currently **no automated tests** (`pnpm --filter @app/api test` invokes `vitest run`, but finds no test files and may exit with a corresponding message). Contributions that add tests are welcome.

## External Services & Costs

- **No required third-party services.** Postgres and SeaweedFS run locally via Docker, free of charge.
- **Optional:** your own FactCheck/Explain/Ask AI provider — either a free local Ollama model, or a paid API (e.g. OpenAI, Anthropic, OpenRouter). Costs only apply if you configure and use such a provider yourself; configured API keys are entered client-side and stored encrypted server-side.

## Data Handling

**What this software stores (when self-hosted)**, locally in your own Postgres database and S3 storage — none of it leaves your own server except where explicitly stated below:
- Account data (email, username, password hash, bio, avatar)
- Posts, comments, stories, snaps, direct messages (**stored unencrypted** in the database, see [Open Items](#open-items))
- Uploaded images (in the configured S3-compatible storage)
- User-configured AI provider settings; the API key is stored AES-256-GCM encrypted and never returned to the client in plaintext

**What is sent to third parties:** only when a user actively triggers FactCheck/Explain/Ask on a post, the post text (plus author and timestamp) is sent to the AI provider that *this user* configured themselves (e.g. OpenAI, Anthropic, or a local Ollama instance). When "share anonymously" (FactCheck transparency log) is used, a generated summary is additionally stored server-side and shown to other users.

Running this software (self-hosting) carries its own data-protection obligations toward your users depending on your jurisdiction (e.g. GDPR) — this is not covered by this repository and is the responsibility of whoever operates it.

## Common Issues

- **`pnpm approve-builds`/`ERR_PNPM_IGNORED_BUILDS`**: pnpm blocks native build scripts (Prisma, argon2, esbuild) by default. Already allow-listed via `allowBuilds` in `pnpm-workspace.yaml`.
- **`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`**: pnpm blocks very recently published packages by default. Already disabled via `minimumReleaseAge: 0` in `pnpm-workspace.yaml`.
- **MinIO image not pullable**: see the note above — SeaweedFS is used instead.
- **`corepack`/`npx pnpm` fails with a signature error**: see "Prerequisites" — use the official pnpm installer instead of corepack.
- **AI provider request fails**: the error message shows the requested URL and the provider's HTTP status/response body — usually a typo in the base URL or model name (e.g. for Ollama: correct port `11434`, model name exactly as in `ollama list`, watch case-sensitivity).

## License

Not finalized yet. Proposal: AGPL-3.0, to ensure transparency even for third-party hosting (discussion welcome). **There is currently no `LICENSE` file** — without one, the code is "all rights reserved" by default, even in a public repository.

## Third-Party Components / Dependency Licenses

Automatically checked (`pnpm -r licenses list`, as of this session): all direct and transitive dependencies are under permissive open-source licenses — **MIT** (240 packages), **Apache-2.0** (37), **BSD-3-Clause** (5), **ISC** (10), **0BSD** (1), and **CC-BY-4.0** for the data package `caniuse-lite` (attribution "Ben Briggs", covered by the normal dependency declaration in `package.json`/`pnpm-lock.yaml`). No GPL/AGPL/LGPL dependencies were found that would trigger copyleft obligations of their own. No third-party images, fonts, icons, or datasets are included in the repository.

This check does not replace a legal license review and only covers the versions installed at the time of the check.

## Contributing

Contributing guidelines to follow. The project is deliberately open to suggestions on architecture and product principles.

## Open Items

Known limitations and next steps before this project should be run in production or made public:

**Security & Privacy**
- No end-to-end encryption for direct messages/group chats — messages are stored in plaintext server-side in the database. Would require real key management/exchange per client.
- `/media/:key` is currently fully publicly readable (no access control), including for private DM/snap images — keys are not guessable (UUID), but there's no auth check.
- Snaps are not yet "block-aware": a blocked user can currently still attempt to send you a snap.

**Moderation**
- There is no admin interface to review reported content (the `Report` model is populated but never evaluated anywhere).
- No automated action on repeated reports (e.g. shadow-ban, temporary suspension).

**Infrastructure**
- The cleanup job for expired story/snap media currently runs as a simple `setInterval` in the API process — for multi-instance deployments this should become a dedicated, coordinated worker/cron job.
- SeaweedFS runs without auth in the dev setup (anonymous S3 credentials) — production needs access control on the storage service itself.
- No CI pipeline (lint/typecheck/test only run locally, manually).

**Product/Legal**
- License decision still pending (AGPL-3.0 proposed, to enforce transparency even for third-party hosting).
- No age verification or minor-safety measures.
- No self-service data export/account deletion (GDPR right-of-access/right-to-erasure currently only possible manually via the database).

**Other**
- Reply threads currently show only one level (direct replies), not a full nested reply tree.
- No retry/backoff on failed AI provider requests (single attempt, the error is surfaced directly to the user).
- No automated tests, no CI.
