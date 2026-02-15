# Security and Approvals

This document explains the current defense layers in the gateway runtime.

## 1. Security Model Summary

Adytum uses multiple safety layers:

1. path sandboxing and permission checks for file operations
2. shell command approval policy for high-risk execution
3. sensitive path and critical file protection
4. audit logging for operational traceability
5. secret redaction during memory persistence

## 2. Path Security (`PathValidator`)

`PathValidator.validate(targetPath, operation)` enforces:

1. resolve path relative to workspace root
2. normalize via `realpath` to prevent symlink escape
3. block writes to critical files (config and secret-critical paths)
4. block known sensitive system paths (`/etc/passwd`, `/root`, `.ssh`, etc.)
5. allow direct access within workspace root
6. otherwise require explicit whitelist permission
7. enforce read-only and expiry constraints on whitelisted entries

Blocked operations throw `PathSecurityError` with `reason` metadata.

## 3. Permission Management

`PermissionManager` stores and applies whitelist entries via `data/security.json`.

Entry fields come from shared schema:

- `path`
- `mode` (`workspace_only`, `read_only`, `full_access`, `just_in_time`)
- `grantedAt`
- `expiresAt` (optional)

This enables controlled access outside workspace for approved paths.

## 4. Shell Execution Approval

The shell tool (`shell_execute`) always consults approval policy through callback.

Approval result controls whether command runs:

- `auto`: run immediately
- `ask`: emit approval request and wait for user action
- `deny`: block execution

For commands touching critical config files, auto mode is downgraded to ask mode.

Approval UX path:

1. runtime requests approval
2. gateway emits `approval_request` WS frame
3. dashboard/user responds with `approval_response`
4. pending approval resolves through `ApprovalService`

## 5. Secrets Handling

`SecretsStore` keeps per-skill secret values in `data/secrets.json`.

- file mode is set to `0600` where supported
- values are loaded into env during skill activation (`SkillLoader.applyEnvOverrides`)
- dashboard should mask values in UI and logs

Current limitation: secrets are not encrypted at rest.

## 6. Redaction Pipeline

`MemoryStore.redactSecrets()` sanitizes common patterns before persistence:

- Discord bot tokens and IDs
- provider API keys (OpenAI, Google, Anthropic, etc.)
- common env assignment patterns

`MemoryDB.redactSensitiveData` can retroactively sanitize stored rows.

## 7. Auditing

`AuditLogger` records:

- model calls and responses
- tool calls and results
- security events
- thought/stream traces

Audit events are retrievable via `/api/logs` and `/api/activity`.

## 8. Threats Covered

Current protections are designed to reduce:

- path traversal and symlink escape
- accidental writes to critical project/system files
- unauthorized shell command execution
- leakage of raw secret strings into persisted memories

## 9. Known Gaps and Improvement Areas

Contributors should be aware of current hardening opportunities:

- encrypt `secrets.json` at rest
- stronger command parsing for shell risk classification
- richer SSRF controls for all network-capable tools
- integrity checks for skill package trust and provenance

## 10. Contributor Checklist

Before merging security-sensitive changes:

1. verify path validation behavior for new file operations
2. verify approval flow for new high-risk actions
3. add or update audit events for security-relevant operations
4. confirm secrets never appear in persisted plaintext logs/memories
