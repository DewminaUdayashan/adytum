# Skill Development Guide

This guide is for contributors who want to build, add, test, and maintain Adytum skills.

## 1. What You Build

A skill is a folder that adds one or both of:

- executable behavior (tools/services)
- instruction context (`SKILL.md`) injected into the agent prompt

Skills are discovered by `SkillLoader` and managed via gateway APIs/dashboard.

## 2. Skill Folder Layout

Recommended plugin skill structure:

```text
workspace/skills/<skill-id>/
  adytum.plugin.json
  index.ts
  SKILL.md
```

Optional additions:

- `references/*.md`: long-form docs referenced by `SKILL.md`
- extra local helper files imported by `index.ts`

Instruction-only skill minimum:

```text
workspace/skills/<skill-id>/
  SKILL.md
```

## 3. Step-by-Step: Create a New Plugin Skill

## Step 1: Create folder

```bash
mkdir -p workspace/skills/my-skill
```

## Step 2: Add manifest (`adytum.plugin.json`)

Use a strict, minimal config schema first.

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "description": "Example plugin skill.",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled": { "type": "boolean", "default": true },
      "apiBaseUrl": { "type": "string" },
      "apiKey": { "type": "string" }
    }
  },
  "uiHints": {
    "apiBaseUrl": { "label": "API Base URL" },
    "apiKey": { "label": "API Key", "sensitive": true }
  },
  "metadata": {
    "requires": {
      "env": ["MY_SKILL_API_KEY"]
    },
    "primaryEnv": "MY_SKILL_API_KEY"
  }
}
```

Manifest rules:

- `id` must be stable and unique
- `configSchema` is required
- keep `additionalProperties: false` unless you intentionally allow free-form config

## Step 3: Implement plugin entry (`index.ts`)

Start with one tool.

```ts
import { z } from 'zod';

const PingSchema = z.object({
  message: z.string().default('hello'),
});

const plugin = {
  id: 'my-skill',
  name: 'My Skill',
  description: 'Example plugin skill.',

  register(api: any) {
    const cfg = (api.pluginConfig || {}) as { enabled?: boolean };
    if (cfg.enabled === false) {
      api.logger.info('my-skill disabled by config');
      return;
    }

    api.registerTool({
      name: 'my_skill_ping',
      description: 'Returns a ping payload from my-skill.',
      parameters: PingSchema,
      execute: async (args: z.infer<typeof PingSchema>) => {
        return {
          ok: true,
          source: 'my-skill',
          echo: args.message,
          timestamp: new Date().toISOString(),
        };
      },
    });
  },
};

export default plugin;
```

Notes:

- keep tools deterministic and JSON-serializable
- validate all input with zod
- prefer explicit return objects over ambiguous strings

## Step 4: Add instruction file (`SKILL.md`)

Example:

```markdown
---
name: my-skill
description: Utilities for my domain task.
metadata: { 'requires': { 'env': ['MY_SKILL_API_KEY'] }, 'primaryEnv': 'MY_SKILL_API_KEY' }
---

# My Skill

Use `my_skill_ping` when user asks to verify this skill is working.
```

Guidelines:

- keep concise and action-focused
- include clear tool usage and constraints
- avoid duplicating long API docs inline; link local `references/` docs

## Step 5: Configure skill entry in `adytum.config.yaml`

```yaml
skills:
  entries:
    my-skill:
      enabled: true
      config:
        enabled: true
        apiBaseUrl: 'https://api.example.com'
      env:
        MY_SKILL_API_KEY: '${MY_SKILL_API_KEY}'
```

Secrets may also be set from dashboard (`PUT /api/skills/:id/secrets`).

## Step 6: Reload and verify

Runtime can hot-reload on file changes. Manual verification:

1. start gateway
2. open dashboard Skills page
3. verify status is `loaded`
4. send a prompt that should trigger your tool
5. verify tool call appears in console stream

Useful checks:

```bash
# list skill statuses
node packages/gateway/dist/cli/index.js skill list
```

```bash
# inspect loaded metadata
curl http://localhost:3001/api/skills
```

## 4. Registering Long-Running Skill Services

If your skill needs background listeners (chat connectors, polling, webhooks), register a service.

Conceptual shape:

```ts
api.registerService({
  id: 'my-skill-service',
  async start(ctx) {
    // open connections, schedule loops, subscribe listeners
  },
  async stop(ctx) {
    // clean up resources
  },
});
```

Lifecycle is handled by `SkillLoader` during init/start/stop/reload.

## 5. Requirement Gating and Eligibility

Use metadata requirements so incompatible skills do not load.

Common patterns:

- binary requirement:
  - `metadata.requires.bins: ["ffmpeg"]`
- any-of binaries:
  - `metadata.requires.anyBins: ["uv", "python3"]`
- env requirement:
  - `metadata.requires.env: ["NOTION_API_KEY"]`
- OS-specific requirement:
  - `metadata.requires.os: ["darwin"]`
- config requirement:
  - `metadata.requires.config: ["execution.defaultChannel"]`

If requirements are unmet, skill status becomes `disabled` with populated `missing` reasons.

## 6. Skill Configuration Design Guidelines

Use these rules to keep skills maintainable:

1. keep config schema strict (`additionalProperties: false`)
2. expose only user-facing config fields needed for operation
3. keep secrets separate from non-secret config where possible
4. add sensible defaults for optional fields
5. use `uiHints` to improve dashboard forms

## 7. Tool Naming and Behavior Guidelines

- use prefixed names (`notion_search`, `discord_send`, `weather_current`)
- keep descriptions operational and explicit
- avoid hidden side effects
- return structured results with key diagnostics
- surface upstream API errors in actionable form

## 8. Instruction-Only Skills

When no executable module is needed, add only `SKILL.md`.

Use instruction-only skills for:

- procedural guidance
- policy overlays
- domain-specific prompting

`SkillLoader` will parse frontmatter and include instructions in system prompt.

## 9. Security and Safety for Skill Authors

- never print secrets in logs
- do not bypass workspace path safety using shell commands unnecessarily
- for network calls, enforce host and timeout discipline
- return redacted errors when upstream payloads contain secrets
- document dangerous actions explicitly in `SKILL.md`

## 10. Troubleshooting

## Skill status is `error`

Check:

- malformed `adytum.plugin.json`
- missing `configSchema`
- invalid plugin export shape
- thrown errors in `register()`

## Skill status is `disabled`

Check:

- `skills.enabled`
- allow/deny lists
- `skills.entries.<id>.enabled`
- `missing` requirements (`env`, `bins`, `os`, `config`)

## Tool is not called by model

Check:

- tool name/description clarity
- `SKILL.md` usage guidance quality
- whether skill instructions are present in active system prompt

## 11. Adding Existing Skill from Another Path

You can load skills outside `workspace/skills` through config:

```yaml
skills:
  load:
    paths:
      - ../external-skills/my-skill
    extraDirs:
      - ../external-skills
```

Priority is still lower than direct workspace skills for ID conflicts.

## 12. Contributor Quality Checklist

Before opening PR:

1. manifest validates and is minimal
2. config schema matches actual runtime reads
3. tool args/results are zod-validated and serializable
4. `SKILL.md` is concise and practical
5. skill loads cleanly and appears as `loaded`
6. one realistic end-to-end prompt successfully triggers intended behavior
