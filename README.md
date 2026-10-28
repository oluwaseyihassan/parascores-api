<p align="center">
  <img src="https://res.cloudinary.com/djsnerfzp/image/upload/q_auto/f_auto/v1780327900/parascores-logo.png" width="110" alt="ParaScores Logo" />
</p>

<h1 align="center">ParaScores API</h1>

<p align="center">
  Robust, real-time REST and WebSocket API powering the <strong>ParaScores</strong> tournament & sports competition management platform.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-Cache%20%26%20Sockets-DC382D?logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Socket.io-4.x-010101?logo=socket.io&logoColor=white" alt="Socket.io" />
  <img src="https://img.shields.io/badge/Paystack-Integrated-0BA4DB" alt="Paystack" />
  <img src="https://img.shields.io/badge/License-Proprietary-blue" alt="License" />
</p>

---

## 📖 Overview

**ParaScores API** is the core backend engine behind [ParaScores](https://parascores.com). It orchestrates complex sports tournaments, multi-season leagues, live match tracking, score submissions, automated payouts, real-time community chat, and fan score predictions.

Built on top of **NestJS 11** and **Prisma ORM 7**, it is architected for high concurrency, real-time responsiveness, modular domain boundaries, and multi-tenant organization hubs.

---

## ✨ Key Features

### 🏆 Tournament & Competition Engine

- **Multiple Tournament Formats**: Supports Single Elimination, Double Elimination, Round-Robin (single & double), Groups + Knockouts, Swiss System matchmaking, and UEFA Champions League-style Swiss league phases.
- **Hybrid Play-Offs & Two-Legged Ties**: Automatic generation of knockout pairings, UEFA Champions League knockout play-off brackets (seeded vs unseeded), two-legged aggregate score tracking, and 3rd place matches.
- **Competitions & Seasons**: Organize tournaments into multi-season overarching competitions (e.g. Premier League 2025/2026), with active season switching and automatic tournament linking.
- **Flexible Management**: Auto-approval or manual participant review, customizable scoring rules, custom vanity slugs, tournament pinning, and practice tournament modes.

### ⏱️ Fixtures & Live Match Tracking

- **Automated Scheduling**: One-click fixture generation with round-robin matrixes, Swiss round pairings, and tournament bracket progressions.
- **Match Lifecycle**: Strict state machine transitions (`SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `POSTPONED`, `CANCELLED`) with `allowReopen` protection against accidental overrides.
- **Granular Match Events**: Live minute-by-minute timeline tracking goals, assists, yellow/red cards, substitutions, own goals, and penalty shootout outcomes.
- **Media Highlights**: Cloudinary-powered video and image highlights tagged directly to matches.
- **Redis Invalidation**: Automatic cache invalidation across mutations to ensure clients always see fresh schedules and scores.

### 📊 Dynamic Standings & Player Profiles

- Real-time league table recalculation (Wins, Draws, Losses, Goals For/Against, Goal Difference, Points, Form).
- Customizable tiebreaker hierarchy (head-to-head, goal difference, goals scored).
- Unified multi-group standings for Swiss & Champions League league stages.
- Player rosters, player statistics (top scorers, assist leaders, discipline records), and team profiles.

### 📝 Score Submissions & Verification

- Dedicated portal for team captains and managers to submit match results and upload photo/video match proof.
- Administrative approval workflow: accept, adjust, or dispute scores before official ledger update.

### 💬 Real-Time Chat & Pulse Stream

- **WebSocket Gateway**: High-performance bi-directional communication built with Socket.IO and backed by the `@socket.io/redis-adapter` for multi-instance scaling.
- **Interactive Community Chat**: Match and tournament chat rooms, @user mentions, emoji reactions, typing indicators, pinned announcements, and administrative soft deletion.
- **Pulse**: Live tournament activity stream capturing instant match milestones, reactions, and spectator cheers.

### 🎯 Score Predictions & Leaderboard

- Fan engagement module allowing users to predict match outcomes and exact scores before kickoff.
- Automated point evaluation system (exact score, correct goal difference, correct outcome) and competitive global/tournament leaderboards.

### 🏢 Multi-Tenant Organization Hubs

- Isolated organization spaces with custom subdomain support (e.g., `brand.parascores.com` or local `*.lvh.me`).
- Custom branding engine: logos, brand colors, banner artwork, and styling configs.
- Multi-tier Role-Based Access Control (`OWNER`, `ADMIN`, `MEMBER`).

### 💳 Payments, Subscriptions & Automated Payouts

- **Modular Paystack Architecture**: Cleanly decoupled domain services for checkout, subscriptions, webhook processing, historical records, payouts, and discount codes.
- **Subscriptions**: Organization Pro tier monthly and yearly recurring billing.
- **Subaccounts & Split Payments**: Automatic split payments and instant bank account payouts to organizers with configurable platform commission cuts.
- **Discounts**: Flexible percentage or fixed-amount promotional codes with usage limits and expiration checks.

### 🔔 Push Notifications & Email

- **Web Push (VAPID)**: Native browser push notifications for fixture alerts, score updates, and announcements.
- **Transactional Emails**: Integrated with Resend and SMTP via Handlebars templates for email verification, password resets, invites, and payment receipts.

### 🛡️ Security, Caching & Observability

- **Authentication**: JWT access & refresh tokens securely stored in HTTP-only cookies with Google OAuth 2.0 social login.
- **Rate Limiting**: Throttler protection against abuse across all sensitive endpoints.
- **Caching**: High-throughput Redis caching for frequently requested fixtures and standings.
- **Observability**: Custom-branded Swagger UI (`/api-docs`) and Sentry error monitoring and node profiling.

---

## 🛠️ Tech Stack

| Category                | Technology                                                                                                                                   |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime & Language**  | [Node.js](https://nodejs.org/) (v22+), [TypeScript](https://www.typescriptlang.org/) (v5.7)                                                  |
| **Framework**           | [NestJS](https://nestjs.com/) (v11) with Express                                                                                             |
| **Database & ORM**      | [PostgreSQL](https://www.postgresql.org/) (v15+), [Prisma ORM](https://www.prisma.io/) (v7.2) with `@prisma/adapter-pg`                      |
| **Caching & Pub/Sub**   | [Redis](https://redis.io/) (`ioredis`), `@socket.io/redis-adapter`                                                                           |
| **Realtime WebSockets** | [Socket.IO](https://socket.io/) (v4.8)                                                                                                       |
| **Authentication**      | [Passport](http://www.passportjs.org/), `@nestjs/jwt`, `passport-google-oauth20`, `bcrypt`                                                   |
| **Payments**            | [Paystack API](https://paystack.com/) & Webhooks                                                                                             |
| **AI / LLM**            | Google Gemini (`@google/genai`), OpenAI-compatible providers (Groq, OpenRouter)                                                              |
| **Cloud Media**         | [Cloudinary](https://cloudinary.com/) (via Multer)                                                                                           |
| **Email & Push**        | [Resend](https://resend.com/), [Nodemailer](https://nodemailer.com/), Handlebars, [Web-Push](https://www.npmjs.com/package/web-push) (VAPID) |
| **Documentation**       | [Swagger / OpenAPI](https://swagger.io/) (`@nestjs/swagger`)                                                                                 |
| **Monitoring**          | [Sentry](https://sentry.io/) (`@sentry/nestjs`)                                                                                              |
| **Containerization**    | [Docker](https://www.docker.com/) (Multi-stage Alpine build)                                                                                 |

---

## 📁 Repository Structure

```text
parascores-api/
├── prisma/
│   ├── schema.prisma          # Database schema (models, relations, enums)
│   ├── migrations/            # SQL migration history
│   └── generated/             # Generated Prisma client output
├── src/
│   ├── admin/                 # Platform administration & metrics
│   ├── ai/                    # AI core & provider integrations
│   ├── audit-logs/            # Security & change event auditing
│   ├── auth/                  # Authentication, guards (JWT, Roles), Google OAuth
│   ├── chat/                  # WebSocket gateway, rooms, messages, reactions
│   ├── common/                # Shared decorators, filters, interceptors
│   ├── competitions/          # Multi-season competitions & followers
│   ├── database/              # Prisma database service & PostgreSQL pool
│   ├── email/                 # Transactional emails & Handlebars templates
│   ├── fixtures/              # Schedule generation, live match updates, pairings
│   ├── groups/                # Group stage structures & draws
│   ├── highlights/            # Match video/image highlights & media
│   ├── locations/             # Geographic locations & venue lookups
│   ├── match-events/          # Goals, cards, substitutions, shootout events
│   ├── notifications/         # Web Push (VAPID) & notification events
│   ├── organizations/         # Multi-tenant hubs, branding, subaccounts
│   ├── participants/          # Tournament entrants & registration requests
│   ├── payments/              # Paystack integration & modular domain services:
│   │   ├── services/          # Checkout, Subscriptions, History, Webhooks, Payouts, DiscountCodes
│   │   └── paystack.service.ts# Low-level Paystack API client
│   ├── players/               # Player profiles, stats & roster links
│   ├── predictions/           # Fan match predictions & leaderboards
│   ├── pulse/                 # Live activity feed & reactions
│   ├── redis/                 # Redis connection client & cache helpers
│   ├── score-submissions/     # Manager score submissions & verification
│   ├── socials/               # Organization social media links
│   ├── sponsors/              # Tournament & organization sponsors
│   ├── standings/             # League tables, group standings & tiebreakers
│   ├── team-invites/          # Team member invitation tokens & emails
│   ├── teams/                 # Team entity management
│   ├── tournament-invites/    # Tournament registration invites
│   ├── tournaments/           # Core tournament management & configurations
│   ├── upload/                # Cloudinary asset uploader
│   ├── users/                 # User profiles, avatars, roles & credentials
│   ├── utils/                 # Shared formatting & calculation utilities
│   ├── venues/                # Match venues & physical pitch management
│   ├── app.module.ts          # Root application module & global guards
│   ├── instrument.ts          # Sentry initialization & profiling
│   └── main.ts                # Application bootstrap, Swagger & CORS config
├── test/                      # E2E test suites (Jest & Supertest)
├── scripts/                   # Migration helpers, diagnostics & smoke tests
├── Dockerfile                 # Multi-stage production container definition
├── prisma.config.ts           # Prisma v7 CLI configuration
└── package.json               # Dependencies & scripts
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: `v22.x` or higher
- **npm**: `v10.x` or higher
- **PostgreSQL**: `v15.x` or higher (running locally or hosted on Supabase / Neon / RDS)
- **Redis**: `v6.x` or higher (running locally or hosted on Upstash / Redis Cloud)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/oluwaseyihassan/parascores-api.git
cd parascores-api
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root by copying `.env.example`:

```bash
cp .env.example .env
```

Configure the environment variables in `.env`:

| Variable                          | Description                                                               | Example / Default                                                |
| :-------------------------------- | :------------------------------------------------------------------------ | :--------------------------------------------------------------- |
| `NODE_ENV`                        | Application runtime environment                                           | `development` / `production`                                     |
| `PORT`                            | HTTP server port                                                          | `3000`                                                           |
| `DATABASE_URL`                    | PostgreSQL connection string                                              | `postgresql://user:pass@localhost:5432/parascores?schema=public` |
| `REDIS_URL`                       | Redis connection URI                                                      | `redis://localhost:6379`                                         |
| `JWT_SECRET`                      | Secret key for signing JWT auth tokens                                    | `your_super_secret_jwt_key`                                      |
| `CLIENT_URL`                      | Public frontend client URL                                                | `http://localhost:3001` or `http://lvh.me:3001`                  |
| `CLIENT_DASHBOARD_URL`            | Organization management frontend URL                                      | `http://manage.lvh.me:3000`                                      |
| `GOOGLE_CLIENT_ID`                | Google OAuth 2.0 Client ID                                                | `your_google_client_id`                                          |
| `GOOGLE_CLIENT_SECRET`            | Google OAuth 2.0 Client Secret                                            | `your_google_client_secret`                                      |
| `GOOGLE_CALLBACK_URL`             | Google OAuth callback URL                                                 | `http://lvh.me:3000/api/auth/google/callback`                    |
| `PAYSTACK_SECRET_KEY`             | Paystack secret key                                                       | `sk_test_...` or `sk_live_...`                                   |
| `PAYSTACK_PUBLIC_KEY`             | Paystack public key                                                       | `pk_test_...` or `pk_live_...`                                   |
| `PAYSTACK_PRO_MONTHLY_PLAN`       | Paystack monthly plan code                                                | `PLN_...`                                                        |
| `PAYSTACK_PRO_YEARLY_PLAN`        | Paystack yearly plan code                                                 | `PLN_...`                                                        |
| `PLATFORM_COMMISSION_PERCENT`     | Default platform transaction commission (%)                               | `5`                                                              |
| `PLATFORM_COMMISSION_PERCENT_PRO` | Discounted commission for Pro organizations (%)                           | `3`                                                              |
| `CLOUDINARY_CLOUD_NAME`           | Cloudinary cloud name                                                     | `your_cloud_name`                                                |
| `CLOUDINARY_API_KEY`              | Cloudinary API key                                                        | `your_cloudinary_api_key`                                        |
| `CLOUDINARY_API_SECRET`           | Cloudinary API secret                                                     | `your_cloudinary_api_secret`                                     |
| `RESEND_API_KEY`                  | Resend API key for transactional emails                                   | `re_...`                                                         |
| `SMTP_HOST` / `SMTP_PORT`         | SMTP email server fallback host and port                                  | `smtp.example.com` / `587`                                       |
| `SMTP_USER` / `SMTP_PASS`         | SMTP credentials                                                          | `user@example.com` / `password`                                  |
| `EMAIL_FROM_ADMIN`                | Sender address for system emails                                          | `ParaScores admin <admin@parascores.com>`                        |
| `VAPID_PUBLIC_KEY`                | Web Push VAPID public key                                                 | `your_vapid_public_key`                                          |
| `VAPID_PRIVATE_KEY`               | Web Push VAPID private key                                                | `your_vapid_private_key`                                         |
| `VAPID_MAILTO`                    | Web Push VAPID contact URI                                                | `mailto:admin@parascores.com`                                    |
| `GOOGLE_GENERATIVE_AI_API_KEY`    | Google Gemini API key                                                     | `your_gemini_api_key`                                            |
| `AI_PROVIDER`                     | Optional LLM provider override (`gemini`, `openai`, `groq`, `openrouter`) | `gemini`                                                         |
| `AI_MODEL`                        | Optional pinned model (e.g. `gemini-2.5-flash`)                           | _default provider model_                                         |
| `SENTRY_DSN`                      | Sentry project DSN for error monitoring                                   | `https://...@sentry.io/...`                                      |

### 3. Initialize the Database

Generate the Prisma client and run all pending migrations:

```bash
# Generate the Prisma client into prisma/generated
npx prisma generate

# Apply migrations to your database
npx prisma migrate dev
```

### 4. Start the Application

```bash
# Development mode with Hot-Reload (watch mode)
npm run start:dev

# Standard start
npm run start

# Production mode (after build)
npm run start:prod
```

The API will be available at **`http://localhost:3000/api`**.

---

## 📚 API Documentation

Interactive Swagger (OpenAPI) documentation is automatically available when running in non-production environments:

👉 **[http://localhost:3000/api-docs](http://localhost:3000/api-docs)**

All REST routes are prefixed with `/api`. Key endpoint groups include:

| Prefix                   | Description                                                                |
| :----------------------- | :------------------------------------------------------------------------- |
| `/api/auth`              | Register, login, refresh token, logout, Google OAuth, password reset       |
| `/api/tournaments`       | CRUD operations, scoring rules, Swiss & knockout generation, followers     |
| `/api/competitions`      | Multi-season competition hubs, seasons overview, active season selection   |
| `/api/fixtures`          | Fixtures query, scheduling, bulk creation, match status, knockout pairings |
| `/api/match-events`      | Timeline events (goals, cards, substitutions, penalty shootouts)           |
| `/api/standings`         | League table computations, group standings, head-to-head records           |
| `/api/participants`      | Team and player registrations, approvals, tournament roster entries        |
| `/api/teams`             | Team creation, roster management, squad members                            |
| `/api/players`           | Player profiles, tournament statistics                                     |
| `/api/score-submissions` | Captain score submissions, proof attachments, organizer reviews            |
| `/api/predictions`       | Match score predictions, submissions, leaderboard rankings                 |
| `/api/organizations`     | Organization hubs, subdomains, branding, members, bank settlement accounts |
| `/api/payments`          | Paystack checkout, subscriptions, webhooks, payouts, discount codes        |
| `/api/chat`              | Chat message history, pin/unpin messages, emoji reactions                  |
| `/api/pulse`             | Live tournament moment feed, fan reactions                                 |
| `/api/notifications`     | Web Push VAPID subscriptions and preference toggles                        |
| `/api/upload`            | Media asset uploads to Cloudinary (images, banners, videos)                |

---

## ⚡ Real-Time WebSocket Events

ParaScores leverages Socket.IO at the root namespace with Redis Pub/Sub adapter support.

### Chat & Match Stream Gateway (`/chat`)

Clients join rooms identified by tournament ID (`tournament:{tournamentId}`) or fixture ID (`fixture:{fixtureId}`):

- **Client Emits**:
  - `join_room` — Join a tournament or match room (`{ tournamentId, fixtureId }`)
  - `leave_room` — Leave the active room
  - `send_message` — Post a chat message (`{ tournamentId, content, replyToId? }`)
  - `typing` — Broadcast typing indicator (`{ tournamentId, isTyping: true }`)
  - `react_message` — Add/remove reaction (`{ messageId, emoji }`)
  - `pin_message` — Pin/unpin a message (moderators only)
- **Server Broadcasts**:
  - `new_message` — Broadcasted to room subscribers
  - `user_typing` — Typing status updates
  - `message_reaction` — Reaction count and user list updates
  - `message_pinned` — Pinned status updates
  - `message_deleted` — Soft-deletion notification
  - `pulse_event` — Real-time match milestone feed item

---

## 🧪 Testing & Code Quality

```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Generate test coverage report
npm run test:cov

# Run end-to-end (e2e) tests
npm run test:e2e

# Run linter and auto-fix formatting issues
npm run lint

# Format codebase with Prettier
npm run format
```

---

## 🐳 Docker Deployment

The application includes an optimized, multi-stage Docker build that runs migrations on startup:

```bash
# Build the Docker image
docker build -t parascores-api .

# Run the container
docker run -p 3000:3000 \
  --env-file .env \
  parascores-api
```

The container automatically runs `npx prisma migrate deploy` before launching `dist/src/main.js`.

---

## 🤝 Contributing

1. Fork the repository and create your feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```
2. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat(tournaments): add tiebreaker rule"
   ```
3. Push to the branch:
   ```bash
   git push origin feature/my-new-feature
   ```
4. Open a Pull Request.

---

## 📄 License

This repository is private and proprietary. All rights reserved &copy; [ParaScores](https://parascores.com).
