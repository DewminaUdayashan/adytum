# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-02-15

### Added

- **Email + Calendar Skill**: Added Google Gmail/Calendar skill with inbox triage, event management, daily briefing, and email-to-meeting workflows.
- **Google OAuth Connect Flow**: Added dashboard-driven Google sign-in flow for skill account connection.
- **Multi-Account Email Operations**: Added multi-account account-label support and cross-account read behavior for email/calendar checks.
- **Quota-Aware Model Visibility**: Added UI support to surface rate-limited models in model selection.
- **Architecture and Skill Docs**: Added dedicated architecture, API, storage, security, skill-system, and skill-development documentation.

### Changed

- **Skill Dashboard UX**: Simplified email-calendar configuration inputs and improved connected-account management.
- **Heartbeat Logging**: Replaced low-value heartbeat output with structured status summaries.
- **Background Session Isolation**: Isolated heartbeat/cron runs from user chat context to prevent system outputs leaking into normal conversations.
- **Codebase Documentation**: Expanded in-code documentation across gateway and shared logic.

### Fixed

- **Plugin Config Validation**: Removed unsupported legacy email-calendar config keys and added migration cleanup for old entries.
- **Chat Reliability**: Fixed prompt/context contamination that caused repeated `STATUS`/`SUMMARY` style responses in normal chat.

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
