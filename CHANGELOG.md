# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-02-10

### Added

- **Dashboard**: Next.js 15 + Tailwind CSS v4 dashboard with dark glassmorphism theme.
- **Activity Feed** (`/`): Real-time social feed of agent actions with type filters, expandable payloads, and inline feedback.
- **Live Console** (`/console`): WebSocket-powered stream of reasoning, tool calls, and model responses with pause/resume.
- **Chat** (`/chat`): Full browser-based chat interface with message bubbles and thinking indicators.
- **Token Analytics** (`/tokens`): Per-model usage cards, daily breakdown tables, and recent request logs.
- **Permissions** (`/permissions`): Grant/revoke file access with mode selector and expiration support.
- **Personality** (`/personality`): SOUL.md visual editor with side-by-side diff preview.
- **Heartbeat** (`/heartbeat`): Goal manager with priority/status controls and raw markdown editor.
- **Feedback System**: 👍/👎 buttons with reason code dropdown and free-text comments on every activity entry.
- **Database Schema**: Drizzle ORM schemas for `traces`, `agent_logs`, `user_feedback`, `token_usage`, `security_events`, and `memories` tables.
- **Database Connection**: PostgreSQL connection module with auto-migration on startup.
- **Gateway API**: REST endpoints for activity, feedback, permissions, personality, and heartbeat management.
- **CORS Support**: `@fastify/cors` configured for dashboard-to-gateway communication.

### Changed

- Removed unused `ink` and `react@18` dependencies from gateway to resolve React version conflict with dashboard's React 19.
- Added `dev:dashboard` script to root `package.json`.

## [0.1.0] - 2026-02-10

### Added

- **Birth Protocol**: Cinematic CLI initialization sequence with ASCII animations.
- **Monorepo Scaffold**: Established `packages/shared` and `packages/gateway`.
- **Agent Runtime**: ReAct reasoning loop with tool registry and streaming support.
- **Security Layer**: Path validation, whitelist enforcement, and audit logging.
- **Model Router**: Role-based routing (`thinking`, `fast`, `local`) via LiteLLM proxy.
- **Shared Protocol**: Zod-validated WebSocket frame system.
- **Zero-Setup Storage**: Auto-provisioning logic for Docker PostgreSQL or SQLite fallback.
- **SOUL.md Engine**: Personality persistence and heartbeat goal tracking.
- **Documentation**: Initial `SPECIFICATION.md`, `README.md`, and `CHANGELOG.md`.
