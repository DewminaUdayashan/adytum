# Adytum Developer Guide

This is the contributor entrypoint for local development of Adytum.

## 1. Documentation Map

Read these first:

- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/GATEWAY_RUNTIME.md`
- `docs/API_REFERENCE.md`
- `docs/SECURITY_AND_APPROVALS.md`
- `docs/STORAGE_AND_MEMORY.md`
- `docs/SKILL_SYSTEM.md`
- `docs/SKILL_DEVELOPMENT_GUIDE.md`

## 2. Prerequisites

- Node.js `>=22`
- npm
- Optional: Docker (for Postgres auto-provision)
- Optional: one or more model provider API keys

## 3. Initial Setup

```bash
npm install
npm run build -w packages/shared
npm run build -w packages/gateway
```

Create root `.env` (example):

```env
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
OPENROUTER_API_KEY=...
```

## 4. Initialize Agent Config

Run Birth Protocol once per workspace:

```bash
node packages/gateway/dist/cli/index.js init
```

This creates:

- `adytum.config.yaml`
- `litellm_config.yaml` (if selected)
- `workspace/SOUL.md`
- `workspace/HEARTBEAT.md`

## 5. Running the System

### Start gateway + dashboard via CLI

```bash
node packages/gateway/dist/cli/index.js start
```

Defaults:

- gateway: `http://localhost:7431`
- dashboard: `http://localhost:7432`
- websocket: `ws://localhost:7431/ws`

### Run dashboard only (dev mode)

```bash
npm run dev -w packages/dashboard
```

## 6. Package Scripts

Workspace root:

```bash
npm run build
npm run test
npm run lint
npm run format
```

Gateway:

```bash
npm run dev --workspace=packages/gateway
npm run test --workspace=packages/gateway
npm run build --workspace=packages/gateway
```

Shared:

```bash
npm run test --workspace=packages/shared
npm run build --workspace=packages/shared
```

## 7. Common Workflows

## Add a new tool to core runtime

1. implement tool in `packages/gateway/src/tools`
2. register it in `startGateway` (`packages/gateway/src/index.ts`)
3. confirm tool appears in runtime tool list and is callable
4. update docs if API surface changed

## Add a new API endpoint

1. add controller handler under `packages/gateway/src/api/controllers`
2. register route under `packages/gateway/src/api/routes`
3. verify from dashboard/client
4. update `docs/API_REFERENCE.md`

## Add or modify a skill

Use the dedicated docs:

- `docs/SKILL_SYSTEM.md`
- `docs/SKILL_DEVELOPMENT_GUIDE.md`

Quick path:

1. add `workspace/skills/<id>/adytum.plugin.json`
2. add `workspace/skills/<id>/index.ts`
3. add `workspace/skills/<id>/SKILL.md`
4. verify `GET /api/skills` shows `status: loaded`

## 8. Validation Checklist Before PR

1. build succeeds for touched packages
2. tests pass (or documented if intentionally skipped)
3. no secrets committed
4. docs updated for behavior/API/config changes
5. skill/config schema changes validated against runtime loading

## 9. Troubleshooting

## Gateway not reachable

- ensure gateway is running on `7431`
- check logs from gateway process
- verify no port conflicts

## Dashboard not connecting

- ensure dashboard runs on `7432`
- ensure gateway WS endpoint is reachable (`ws://localhost:7431/ws`)

## Skill not loading

- inspect `/api/skills` response
- check `status`, `error`, and `missing`
- confirm manifest has valid `id` and `configSchema`

## Model failures

- verify provider keys in `.env`
- inspect routing config (`/api/config/routing`)
- check chain config (`/api/config/chains`)

## 10. Related Docs

- `README.md` for user-oriented setup
- `SPECIFICATION.md` for roadmap/spec direction
- `MEMORY_MANAGEMENT.md` for historical memory strategy notes
