# Skills System Audit: OpenClaw Reference vs Adytum

Date: 2026-02-11
Scope: `reference-project/openclaw-main` compared with current Adytum implementation in this repo.

## TL;DR

OpenClaw and Adytum currently use different skill models:

- OpenClaw supports **AgentSkills folders** (plain `SKILL.md`) as the primary skill unit.
- Adytum supports **plugin-style skills** (requires `adytum.plugin.json` + executable `index.*`).

This is the main reason a skill copied directly from OpenClaw may not appear in Adytum.

---

## 1. How Skills Work in OpenClaw (Reference Project)

## 1.1 Two layers: Skills and Plugins

OpenClaw has two separate but related systems:

1. **Skills (AgentSkills-compatible)**
- Folder-based, instruction-first units (`SKILL.md`).
- Loaded into prompt context and optionally exposed as slash commands.
- Core loader: `reference-project/openclaw-main/src/agents/skills/workspace.ts`.

2. **Plugins (runtime extensions)**
- Code modules with `openclaw.plugin.json` + runtime registration.
- Can register tools/channels/services/providers.
- May also expose additional skill directories via manifest `skills`.
- Core loader: `reference-project/openclaw-main/src/plugins/*`.

Important: OpenClaw’s **skills are not the same thing as plugins**.

## 1.2 Skill discovery sources and precedence

OpenClaw skill discovery (from `workspace.ts`):

- Bundled skills (inside OpenClaw install)
- Managed skills (`~/.openclaw/skills`)
- Workspace skills (`<workspace>/skills`)
- Extra directories (`skills.load.extraDirs`)
- Plugin-provided skill dirs (`manifest.skills` paths from enabled plugins)

Actual merge precedence in code (`workspace.ts:159`):

- `extra < bundled < managed < workspace`

So workspace skills override managed/bundled versions with the same skill name.

## 1.3 Eligibility / gating model

OpenClaw parses frontmatter metadata from `SKILL.md` (`frontmatter.ts`) and filters skills (`config.ts`) at load time.

Supported gates include:

- OS gating: `metadata.openclaw.os`
- Required binaries: `requires.bins`, `requires.anyBins`
- Required env vars: `requires.env`
- Required config paths: `requires.config`
- Always include: `always: true`
- Per-skill enable/disable: `skills.entries.<skillKey>.enabled`
- Bundled allowlist: `skills.allowBundled`

This is much richer than simple allow/deny.

## 1.4 Per-run env injection

OpenClaw applies skill-specific env values at runtime and restores afterward:

- `skills.entries.<key>.env`
- `skills.entries.<key>.apiKey` mapped via `metadata.openclaw.primaryEnv`
- Implementation: `src/agents/skills/env-overrides.ts`

## 1.5 Prompt + command generation

OpenClaw builds a skill snapshot/prompt and excludes `disable-model-invocation` skills when needed.

It can also auto-generate user commands from skills (`workspace.ts:334+`) using frontmatter keys:

- `user-invocable`
- `command-dispatch`
- `command-tool`
- `command-arg-mode`

## 1.6 Auto-refresh and remote node awareness

OpenClaw watches skill directories via chokidar and bumps snapshot versions (`refresh.ts`).

It also supports remote-node eligibility (`skills-remote.ts`), e.g. allowing macOS-gated skills if a connected macOS node has required bins.

## 1.7 Skills management API + UI

Gateway methods (`src/gateway/server-methods/skills.ts`):

- `skills.status`
- `skills.bins`
- `skills.install`
- `skills.update`

UI (`ui/src/ui/controllers/skills.ts`, `ui/src/ui/views/skills.ts`) shows:

- eligibility status
- missing requirements
- install actions
- enable/disable toggles
- API key updates

## 1.8 How OpenClaw allows external skills

OpenClaw external-skill paths:

1. Drop folder in `<workspace>/skills/<name>/SKILL.md`
2. Drop folder in `~/.openclaw/skills/<name>/SKILL.md`
3. Add custom directories in `skills.load.extraDirs`
4. Install via ClawHub (`clawhub install <slug>`)
5. Enable a plugin that contributes skill directories via plugin manifest `skills`

No skill runtime code is required for plain instruction skills.

---

## 2. How Skills Work in Adytum (Current)

Adytum currently uses a plugin-style skill model.

Core: `packages/gateway/src/agent/skill-loader.ts`

## 2.1 Discovery model

Discovery sources:

- `workspace/skills/*`
- extra `skills.load.paths` from config

Each candidate must have:

1. entry source (`index.ts/js/...` or `package.json -> adytum.extensions`)
2. `adytum.plugin.json` manifest

If source is missing, the folder is skipped (`skill-loader.ts:441-443`).
If manifest is missing, skill becomes error (`skill-loader.ts:527-533`).

## 2.2 Config and enablement

Adytum config (`packages/shared/src/types.ts`):

- `skills.enabled`
- `skills.allow`
- `skills.deny`
- `skills.load.paths`
- `skills.entries.<id>.enabled`
- `skills.entries.<id>.config`

Enable logic is currently simple allow/deny/entries checks (`skill-loader.ts:631+`).

## 2.3 Instructions usage

Adytum reads:

- root `SKILL.md`
- optional files listed in `manifest.skills`

These are merged into one instruction block and injected into system prompt via:

- `SkillLoader.getSkillsContext()`
- `AgentRuntime.buildSystemPrompt()` (`packages/gateway/src/agent/runtime.ts:383+`)

## 2.4 What Adytum does not currently have (vs OpenClaw)

- No SKILL-only discovery mode (plain `SKILL.md` skills)
- No managed shared dir equivalent to `~/.openclaw/skills`
- No bundled-skill precedence model
- No metadata-based eligibility gates (`requires.bins/env/config/os`)
- No per-run skill env/apiKey injection mechanism like OpenClaw
- No built-in skill installer flow like ClawHub integration
- No automatic watcher-based skill refresh from directory changes
- No remote-node capability-aware skill eligibility

---

## 3. Why Your Copied OpenClaw Weather Skill Didn’t Show

Root cause:

- OpenClaw `weather` is a **plain SKILL-only folder** (`reference-project/openclaw-main/skills/weather/SKILL.md`).
- Adytum loader does not load plain SKILL-only folders.

In Adytum, the folder is ignored unless it has executable entry source (`index.*`) and `adytum.plugin.json`.

So a direct copy from OpenClaw skills folder will not load by default in Adytum.

---

## 4. Discord Skill Behavior Difference (Important)

In OpenClaw, the `skills/discord/SKILL.md` is guidance text. The heavy functionality comes from OpenClaw Discord channel/tool runtime:

- action router: `src/agents/tools/discord-actions.ts`
- channel action adapter: `src/channels/plugins/actions/discord.ts`
- large Discord runtime stack: `src/discord/*`

So copying only `SKILL.md` from OpenClaw does not copy the underlying runtime capabilities.

In Adytum, Discord functionality lives in your Adytum plugin implementation (`workspace/skills/discord/index.ts`) and must be explicitly implemented there.

---

## 5. Side-by-Side Comparison

| Area | OpenClaw | Adytum (current) |
|---|---|---|
| Primary skill format | AgentSkills folder (`SKILL.md`) | Plugin skill (`adytum.plugin.json` + `index.*`) |
| SKILL-only support | Yes | No |
| Discovery locations | bundled + managed + workspace + extraDirs + plugin skill dirs | workspace + `skills.load.paths` |
| Precedence model | Yes (`extra < bundled < managed < workspace`) | No explicit source precedence model |
| Eligibility gates | rich metadata (`os`, bins, env, config, always) | only enabled/allow/deny |
| Per-run env overrides | Yes (`env`, `apiKey` + `primaryEnv`) | No equivalent framework-level lifecycle |
| Auto-refresh watcher | Yes | No (reload-based) |
| Remote-node aware eligibility | Yes | No |
| Skills install workflow | yes (`skills.install`, ClawHub flows) | none built-in |
| UI skill diagnostics | eligibility + missing reasons + install options | manifest/config editing UI |

---

## 6. What “Exact OpenClaw Standard” Would Mean for Adytum

To match OpenClaw behavior closely, Adytum would need to support both:

1. **Instruction skills** (plain `SKILL.md` folders)
2. **Plugin skills** (runtime tools/services)

Recommended target architecture:

1. Add `instruction` skill type in loader
- discover folders containing `SKILL.md` even without manifest/entry
- assign deterministic id (`folder name` or frontmatter name)

2. Keep plugin skills as-is for runtime capabilities
- keep `adytum.plugin.json` + `index.*` path for tools/services

3. Add OpenClaw-style metadata parser for `SKILL.md`
- parse frontmatter + `metadata` JSON
- implement gating (`requires.*`, `os`, `always`, `primaryEnv`)

4. Add additional discovery roots + precedence
- managed global dir (e.g. `~/.adytum/skills`)
- optional bundled skills dir
- extra dirs

5. Add skill status diagnostics API
- include `eligible`, `missing`, `source`, `install options`

6. Add watcher-based hot reload
- watch skill roots and refresh snapshot

This gives OpenClaw-like interoperability while preserving Adytum plugin power.

---

## 7. Practical Rule for Your Team Today

If a skill is copied from OpenClaw and contains only `SKILL.md`, it is an **instruction skill**.

In current Adytum, it must be adapted into a plugin-style skill (manifest + entry module), or Adytum loader must be extended to support SKILL-only skills.

That is the exact mismatch you are seeing.

---

## 8. Key Evidence Files Reviewed

OpenClaw:

- `reference-project/openclaw-main/src/agents/skills/workspace.ts`
- `reference-project/openclaw-main/src/agents/skills/config.ts`
- `reference-project/openclaw-main/src/agents/skills/frontmatter.ts`
- `reference-project/openclaw-main/src/agents/skills/env-overrides.ts`
- `reference-project/openclaw-main/src/agents/skills/refresh.ts`
- `reference-project/openclaw-main/src/agents/skills/plugin-skills.ts`
- `reference-project/openclaw-main/src/agents/skills-status.ts`
- `reference-project/openclaw-main/src/gateway/server-methods/skills.ts`
- `reference-project/openclaw-main/docs/tools/skills.md`
- `reference-project/openclaw-main/docs/tools/skills-config.md`
- `reference-project/openclaw-main/docs/tools/plugin.md`
- `reference-project/openclaw-main/docs/tools/clawhub.md`
- `reference-project/openclaw-main/skills/weather/SKILL.md`
- `reference-project/openclaw-main/skills/discord/SKILL.md`
- `reference-project/openclaw-main/src/agents/tools/discord-actions.ts`

Adytum:

- `packages/gateway/src/agent/skill-loader.ts`
- `packages/gateway/src/agent/runtime.ts`
- `packages/gateway/src/server.ts`
- `packages/gateway/src/config.ts`
- `packages/shared/src/types.ts`
- `packages/dashboard/src/app/skills/page.tsx`
- `packages/dashboard/src/lib/api.ts`

