# InTouch - The Actually Social Social Media

Open-source social media: text/image posts, stories, snaps, DMs — **strictly chronological feed, no ranking algorithm, no ads**, with a freely choosable FactCheck/Explain/Ask AI (bring your own API keys, including local Ollama models).

## Purpose & Audience

A social media prototype for anyone who wants the strengths of Twitter (threads, replies), Instagram (stories, profiles), and Snapchat (snaps) combined — without an engagement-optimized algorithm, without ads, with self-directed, freely choosable AI assistance for putting posts into context. Intended for developers who want to experiment locally, self-host, or contribute. **Not a finished, production-ready product** — see [Open Items](#open-items).

## Features

- Chronological feed of posts and follow activity (no ranking algorithm) with a "you're all caught up" marker
- Text/image posts, reply threads, nested comments, comment likes
- Personal notifications for follows, comments, replies, likes, mentions, messages, and Snaps
- Stories (24h) and snaps (view-once) with "close friends" visibility
- Direct messages including group chats, realtime via Socket.io
- Profiles (bio, avatar, own posts)
- Moderation: block, report
- Invite-only registration: one-time 14-day invitation links, up to 100 active invites per member; invited members can invite friends onward
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

# Apply the DB schema (run from the project root)
pnpm --filter @app/api prisma:migrate

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

For non-local deployments, generate independent secrets (for example, run `openssl rand -hex 32` three times) and set `JWT_SECRET`, `AI_KEY_ENCRYPTION_SECRET`, and `BOOTSTRAP_INVITE_CODE` to the three outputs. The API refuses known placeholders and secrets shorter than 32 characters when `NODE_ENV=production`.

| Variable | Purpose | Example/placeholder |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://app:app@localhost:5432/app` (dev default from `docker-compose.yml`) |
| `JWT_SECRET` | Signing key for auth cookies | **Must be replaced with a long random string before any real deployment** |
| `AI_KEY_ENCRYPTION_SECRET` | Key used to encrypt stored AI API keys (AES-256-GCM) | **Must be replaced before any real deployment** |
| `BOOTSTRAP_INVITE_CODE` | One-time invite used only to register the first account in a fresh database | **Set a random value of at least 32 characters; remove it after the first account is created** |
| `OPENROUTER_API_KEY` | Optional shared key for the default OpenRouter Free provider; users can also add personal keys in AI Tools | Leave empty to require each user to provide a key |
| `PORT` | API port | `4000` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |
| `NODE_ENV` | Environment | `development` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage (SeaweedFS in the dev setup, without real auth) | see `.env.example` |

`apps/web/.env`:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE` | Base URL of the API the frontend talks to |

## Production Deployment (Hetzner)

The repository includes a single-server Docker Compose deployment for a small invite-only test. It uses Caddy for HTTPS, PostgreSQL and media storage on private Docker networks, and persistent Docker volumes. This is not high availability: keep off-server backups and monitor disk space. The bundled SeaweedFS S3 gateway has no authentication and is intentionally not published to the internet; for a public launch, use authenticated object storage such as Hetzner Object Storage and set its endpoint and credentials in `.env.production`.

1. Create an Ubuntu 24.04 server at Hetzner. Allow inbound TCP `22`, `80`, and `443`, plus UDP `443` for HTTP/3. Do not expose PostgreSQL `5432` or SeaweedFS `8333`. Point DNS records `A intouchsocial.com`, `A www.intouchsocial.com`, and `A api.intouchsocial.com` to the server's public IPv4 address. Only add `AAAA` records if IPv6 is configured and reachable.
2. Install Docker Engine and the Docker Compose plugin using Docker's official Ubuntu instructions. Clone this repository on the server and enter the project directory.
3. Create the private production environment file and generate separate random values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `AI_KEY_ENCRYPTION_SECRET`, and `BOOTSTRAP_INVITE_CODE`:

	```bash
	cp .env.production.example .env.production
	chmod 600 .env.production
	openssl rand -hex 32
	```

	Run `openssl rand -hex 32` separately for each value. Paste the outputs directly into `.env.production`; never commit or share that file. Set `ACME_EMAIL` to an address you control. The default `S3_ENDPOINT` uses the private, single-server SeaweedFS service. `OPENROUTER_API_KEY` is optional.
4. Build and start the stack:

	```bash
	docker compose --env-file .env.production -f compose.production.yaml up -d --build
	docker compose --env-file .env.production -f compose.production.yaml ps
	curl https://api.intouchsocial.com/health
	```

	Caddy obtains and renews HTTPS certificates after DNS resolves and ports `80`/`443` are reachable. The API applies Prisma migrations before it starts. On the first boot, open `https://intouchsocial.com/register#invite=<BOOTSTRAP_INVITE_CODE>` and create the first account. Then remove `BOOTSTRAP_INVITE_CODE` from `.env.production` and recreate the API container:

	```bash
	docker compose --env-file .env.production -f compose.production.yaml up -d --force-recreate api
	```

5. Before inviting friends, configure automated off-server backups for both PostgreSQL and uploaded media, test restoring them, and monitor disk space and container health. Docker volumes survive container replacement but are not backups. Deploy updates with `git pull` followed by the same `up -d --build` command; take a database backup before releases that change Prisma migrations.

The frontend is built with `PUBLIC_API_URL` (default `https://api.intouchsocial.com`) and the API allows `CORS_ORIGIN` (default `https://intouchsocial.com`). If you use different hostnames, update both values and the site names in `Caddyfile`, then rebuild. The example deployment is a single VPS; it does not provide redundancy, automated off-site backups, or an admin/moderation UI.

## Usage

After starting the app with a fresh database, set `BOOTSTRAP_INVITE_CODE` in `apps/api/.env`, restart the API, and open `http://localhost:5173/register#invite=<BOOTSTRAP_INVITE_CODE>` to create the first account. The code is in the URL fragment so browsers do not send it in HTTP requests. Remove the bootstrap value and restart the API after setup. That first member can create invite links from **Invite friends**; each link works once, expires after 14 days, and each member may have up to 100 active invites. Share links manually; the app does not email invitations. Invited members can issue their own links. Then post and follow others from the feed. Each user gets an **OpenRouter Free** provider by default under **AI Tools**; it uses OpenRouter's free-model router and requires either `OPENROUTER_API_KEY` on the server or a personal API key. Users can also configure other providers, such as a local Ollama instance at `http://localhost:11434/v1`.

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
- **AI tools:** OpenRouter Free is configured by default for each user. It needs a shared `OPENROUTER_API_KEY` from the operator or a personal API key from the user. OpenRouter controls free-model availability and limits; provider policies apply to submitted content. Users may instead configure a local Ollama model or another provider. Personal API keys are stored encrypted server-side.

## Data Handling

**What this software stores (when self-hosted)**, locally in your own Postgres database and S3 storage — none of it leaves your own server except where explicitly stated below:
- Account data (email, username, password hash, bio, avatar)
- Posts, comments, stories, profile details, general social activity, and their media are server-readable and are not end-to-end encrypted
- New Snap image and caption content is encrypted in the sender's browser; Snap sender/recipient identities, delivery times, expiry, and viewed status remain server-readable
- New direct/group message content is encrypted in the sender's browser; older messages remain plaintext. Message metadata and device public keys are server-readable. Device private keys stay in browser IndexedDB (see [Open Items](#open-items))
- Uploaded images (in the configured S3-compatible storage)
- Invitation token hashes and inviter/expiry/redemption metadata; raw invite codes are only returned once to the inviter and are not stored
- User-configured AI provider settings; personal API keys are stored AES-256-GCM encrypted and never returned to the client in plaintext. A shared OpenRouter key, if configured, remains in the server environment.

**What is sent to third parties:** when a user actively triggers Fact-check/Explain/Ask on a post, the post text (plus author and timestamp) is sent to the selected AI provider. The default provider is OpenRouter Free unless the user selects another provider. When "share anonymously" (fact-check transparency log) is used, a generated summary is additionally stored server-side and shown to other users.

Running this software (self-hosting) carries its own data-protection obligations toward your users depending on your jurisdiction (e.g. GDPR) — this is not covered by this repository and is the responsibility of whoever operates it.

## Common Issues

- **`pnpm approve-builds`/`ERR_PNPM_IGNORED_BUILDS`**: pnpm blocks native build scripts (Prisma, argon2, esbuild) by default. Already allow-listed via `allowBuilds` in `pnpm-workspace.yaml`.
- **`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`**: pnpm blocks very recently published packages by default. Already disabled via `minimumReleaseAge: 0` in `pnpm-workspace.yaml`.
- **MinIO image not pullable**: see the note above — SeaweedFS is used instead.
- **`corepack`/`npx pnpm` fails with a signature error**: see "Prerequisites" — use the official pnpm installer instead of corepack.
- **AI provider request fails**: the error message shows the requested URL and the provider's HTTP status/response body — usually a typo in the base URL or model name (e.g. for Ollama: correct port `11434`, model name exactly as in `ollama list`, watch case-sensitivity).

## License

The project's original code is licensed under **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**. See [`LICENSE`](LICENSE) for the SPDX identifier and link to the complete license text. This license does not replace the licenses of third-party dependencies or grant rights to material the project authors do not own.

## Third-Party Components / Dependency Licenses

Automatically checked (`pnpm -r licenses list`, as of this session): installed dependencies report **MIT** (240 packages), **Apache-2.0** (37), **BSD-3-Clause** (5), **ISC** (10), **0BSD** (1), and **CC-BY-4.0** (1). No GPL/AGPL/LGPL dependencies were reported. The CC-BY-4.0 package is the transitive build-data dependency `caniuse-lite`; its upstream project says the data is from [caniuse.com](https://caniuse.com/) and is available under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). If redistributing that data or an artifact containing it, attribute the source as caniuse.com, link the license, and identify modifications as required by the license. The dependency package includes its license text. No third-party images, fonts, or icons are included in this repository.

This automated metadata check does not replace a legal license review, verify every dependency's bundled notices, or cover future package versions. Redistributing built bundles may require shipping third-party license notices.

## Contributing

Contributing guidelines to follow. The project is deliberately open to suggestions on architecture and product principles.

## Open Items

Known limitations and next steps before this project should be run in production or made public:

**Security & Privacy**
- End-to-end encryption applies to new text messages in direct/group chats and to new Snap images/captions. Legacy messages and Snaps remain plaintext; Snap routing/view metadata, profiles, posts, comments, stories, notifications, and AI prompts are not end-to-end encrypted.
- Device private keys are browser-local with no recovery or history transfer. Public keys are distributed by the server; users must compare fingerprints through another trusted channel to detect key substitution. E2EE does not protect against compromised devices, malicious served client code, or unverified keys.
- `/media/:key` now requires authentication and checks access against upload ownership and the referenced post/story/snap visibility; responses are marked private/no-store. Keep the S3 service itself private in production.
- Uploaded files that are never attached to a post, story, snap, or avatar do not yet have an orphan cleanup policy.
- Invite creation is capped at 100 active links per account, but there is no general API rate limiter yet; monitor invite abuse and add rate limits before a wider launch.

**Moderation**
- There is no admin interface to review reported content (the `Report` model is populated but never evaluated anywhere).
- No automated action on repeated reports (e.g. shadow-ban, temporary suspension).

**Infrastructure**
- The cleanup job for expired story/snap media currently runs as a simple `setInterval` in the API process — for multi-instance deployments this should become a dedicated, coordinated worker/cron job.
- SeaweedFS runs without auth in the dev setup; Docker Compose binds its port and Postgres to loopback. Production needs private storage networking and real credentials.
- Postgres still uses the development-only `app`/`app` credentials. Do not expose this dev configuration to an untrusted network.
- No CI pipeline (lint/typecheck/test only run locally, manually).

**Product/Legal**
- Project code is marked AGPL-3.0-only; `LICENSE` uses an SPDX identifier and links to the full canonical text rather than embedding it. Consider including the complete text for easier offline review and license detection.
- No age verification or minor-safety measures.
- No self-service data export/account deletion (GDPR right-of-access/right-to-erasure currently only possible manually via the database).

**Other**
- Reply threads currently show only one level (direct replies), not a full nested reply tree.
- No retry/backoff on failed AI provider requests (single attempt, the error is surfaced directly to the user).
- No automated tests, no CI.
