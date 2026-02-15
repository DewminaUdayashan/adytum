# Skill System Internals

This document explains how the Adytum skill system works at runtime.

## 1. Skill Types

Adytum supports two skill forms:

1. Plugin skills
   - include `adytum.plugin.json`
   - include executable entry (`index.ts`/`index.js`/etc or `package.json` extension path)
   - can register tools and services

2. Instruction-only skills
   - include `SKILL.md`
   - no executable module required
   - contribute prompt instructions only

## 2. Discovery Sources and Priority

`SkillLoader` discovers skills from:

1. workspace skills: `workspace/skills/*` (highest priority)
2. managed skills: `~/.adytum/skills/*`
3. extra paths from config (`skills.load.paths`, `skills.load.extraDirs`)

If duplicate `id` values exist, higher priority source wins.

## 3. Manifest and Metadata

Plugin manifest file: `adytum.plugin.json`

Core fields:

- `id` (required)
- `name`, `description`, `version`
- `configSchema` (required JSON schema object)
- `channels`, `providers`, `skills`, `uiHints`
- `metadata` (openclaw-compatible metadata envelope)

Metadata is normalized into runtime requirements:

- `requires.bins`
- `requires.anyBins`
- `requires.env`
- `requires.config`
- `requires.os`
- `primaryEnv`
- `always`
- `communication`
- `install` (install hints)

Instruction-only skills derive minimal manifest data from `SKILL.md` frontmatter.

## 4. Enablement and Eligibility

For each discovered skill, `resolveEnableState` checks:

1. global `skills.enabled`
2. deny/allow lists
3. per-entry `enabled` override
4. OS requirements
5. required binaries
6. required env vars or configured API key
7. required config paths

Skill status values:

- `discovered`
- `loaded`
- `disabled`
- `error`

Additional runtime diagnostics:

- `missing` fields (bins/env/config/os)
- `eligible` boolean
- `error` string

## 5. Plugin Contract

Runtime plugin API (`AdytumSkillPluginApi`) exposes:

- identity: `id`, `name`, `source`, `rootDir`, `manifest`
- runtime context: `config`, `pluginConfig`, `logger`
- helpers:
  - `resolvePath(value)`
  - `registerTool(tool)`
  - `registerService(service)`

Accepted module export forms:

1. plugin object with `register(api)` or `activate(api)`
2. function export treated as `register(api)`
3. legacy object (`tools`, `onLoad`, `onUnload`)

## 6. Config Validation

Before plugin activation, runtime validates `skills.entries.<id>.config` against manifest `configSchema`.

Validation currently supports common JSON schema constructs:

- `type` object/array/string/boolean/number/integer
- `required`
- `properties`
- `additionalProperties`
- `enum`

Invalid config prevents load and sets skill status to `error`.

## 7. Secrets and Env Injection

Secrets flow:

1. dashboard or config updates skill secrets
2. `SecretsStore` persists to `data/secrets.json`
3. `SkillLoader.setSecrets` receives in-memory map
4. `applyEnvOverrides` maps entry env + secret values into `process.env`
5. plugin runtime reads values from config or environment

`primaryEnv` and known communication-skill conventions are respected.

## 8. Prompt Injection from Skills

`SkillLoader.getSkillsContext()` builds prompt section for active skills:

- skill name and description
- selected non-secret config values
- merged instructions from `SKILL.md` and any referenced instruction files

This context is appended into `AgentRuntime` system prompt.

## 9. Service Lifecycle

Skills may register long-running services (`AdytumSkillService`).

Lifecycle order:

1. `init`: discover and load plugins, register tools/services
2. `start(agent)`: call each service `start(ctx)`
3. `stop()`: call each started service `stop(ctx)` in reverse order
4. `reload(agent)`: stop -> init -> start

## 10. Hot Reload

The gateway watches `workspace/skills` recursively.

On file change:

1. debounce reload trigger
2. refresh loader config and secrets
3. reload skills
4. refresh agent system prompt

This enables iterative plugin development without process restart.

## 11. Skill API Surface (Gateway)

Skill management endpoints:

- `GET /api/skills`
- `GET /api/skills/:id`
- `PUT /api/skills/:id`
- `GET /api/skills/:id/instructions`
- `PUT /api/skills/:id/instructions`
- `PUT /api/skills/:id/secrets`

These endpoints provide metadata, status, config updates, instruction editing, and secret updates.

## 12. Troubleshooting Skill Loads

If a skill does not load:

1. call `GET /api/skills` and inspect `status` + `error`
2. inspect `missing` requirement fields
3. confirm manifest JSON is valid and has `id` + `configSchema`
4. verify entry file exists and exports supported plugin shape
5. verify config matches schema
6. check gateway startup logs for loader output
