# Gateway API Reference

This document covers the current public API surface exposed by `packages/gateway`.

Base defaults:

- Gateway HTTP: `http://localhost:3001`
- Gateway WS: `ws://localhost:3001/ws`

## 1. REST Endpoints

## Health

- `GET /api/health`

Returns basic health metadata.

## Swarm and Session Operations

- `GET /api/memories`
- `PUT /api/memories/:id`
- `DELETE /api/memories/:id`
- `GET /api/approvals`
- `POST /api/approvals/:id`
- `POST /api/feedback`
- `GET /api/personality`
- `PUT /api/personality`
- `GET /api/heartbeat`
- `PUT /api/heartbeat`

## Skills

- `GET /api/skills`
- `GET /api/skills/:id`
- `PUT /api/skills/:id`
- `GET /api/skills/:id/instructions`
- `PUT /api/skills/:id/instructions`
- `PUT /api/skills/:id/secrets`

## Models

- `GET /api/models`
- `POST /api/models`
- `PUT /api/models/:id`
- `DELETE /api/models/:id`
- `POST /api/models/scan`

## Runtime Config

- `GET /api/config/roles`
- `GET /api/config/chains`
- `PUT /api/config/chains`
- `GET /api/config/routing`
- `PUT /api/config/routing`
- `GET /api/config/overrides`
- `PUT /api/config/overrides`
- `GET /api/config/soul`
- `PUT /api/config/soul`

## Schedules

- `GET /api/schedules`
- `PUT /api/schedules`

## System and Analytics

- `GET /api/tokens`
- `GET /api/logs`
- `GET /api/activity`
- `GET /api/link-preview`

## Cron Jobs

- `GET /api/cron`
- `POST /api/cron`
- `PUT /api/cron/:id`
- `DELETE /api/cron/:id`

## 2. WebSocket Protocol

WS route:

- `GET /ws` (websocket upgrade)

Shared frame schemas live in `packages/shared/src/protocol.ts`.

Supported frame `type` values include:

- `connect`
- `disconnect`
- `message`
- `stream`
- `tool_call`
- `tool_result`
- `control`
- `feedback`
- `token_update`
- `error`
- `heartbeat_ping`
- `heartbeat_pong`
- `approval_request`
- `approval_response`

## 3. Message Send Contract

Typical client->gateway chat frame:

```json
{
  "type": "message",
  "sessionId": "d11a035d-f615-40a7-a6d1-236f1f4996cc",
  "content": "Summarize latest project progress",
  "modelRole": "thinking"
}
```

Optional overrides:

- `modelRole`
- `modelId`

## 4. Streaming Response Contract

Gateway emits stream frames while the turn is in progress:

```json
{
  "type": "stream",
  "sessionId": "d11a035d-f615-40a7-a6d1-236f1f4996cc",
  "traceId": "5d11de40-4a2f-42ca-9964-1f2f0dc3489d",
  "streamType": "tool_call",
  "delta": "Calling tool: file_read",
  "metadata": { "tool": "file_read" }
}
```

Current `streamType` values:

- `thinking`
- `response`
- `tool_call`
- `tool_result`
- `status`

## 5. Approval Flow

When an action needs manual approval, gateway broadcasts:

```json
{
  "type": "approval_request",
  "id": "56cb4daf-2d2e-4f15-8d40-8e43ef67e5da",
  "kind": "shell",
  "description": "Run command: rm -rf /tmp/foo",
  "meta": {},
  "expiresAt": 1739476123000
}
```

Client responds with:

```json
{
  "type": "approval_response",
  "id": "56cb4daf-2d2e-4f15-8d40-8e43ef67e5da",
  "approved": false
}
```

## 6. Token Analytics Contract

`GET /api/tokens` supports optional filters:

- `from` (unix ms)
- `to` (unix ms)
- `limit`
- `provider` (comma-separated)
- `modelId` (comma-separated)

Response includes:

- `total`
- `byProvider`
- `byModel`
- `daily`
- `recent`

## 7. Error Semantics

- REST handlers throw `AppError` for typed failures
- global Fastify error middleware maps thrown errors to HTTP responses
- WebSocket handler emits `error` frame on malformed input or runtime failures

## 8. Compatibility Guidance

If you add or modify API fields:

1. update shared zod schemas in `packages/shared`
2. update gateway controller/route behavior
3. update dashboard client adapters in `packages/dashboard/src/lib/api.ts`
4. update this document
