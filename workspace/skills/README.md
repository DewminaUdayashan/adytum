# Skills (Adytum Plugin Standard)

Adytum loads skills using the Adytum plugin contract.

Each skill lives under `workspace/skills/<skill-id>/` and must include:

- `adytum.plugin.json` (required)
- `index.ts` or `index.js` (required)
- `SKILL.md` (optional, recommended for LLM guidance)

## 1. Manifest (`adytum.plugin.json`)

Minimum shape:

```json
{
  "id": "my-skill",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

`id` and `configSchema` are required.

## 2. Plugin Entry (`index.ts`)

Export a default plugin object with `register(api)`.

Inside `register`, you can:

- `api.registerTool(tool)`
- `api.registerService(service)`

Service lifecycle:

- `start(ctx)` runs after the agent runtime is ready
- `stop(ctx)` runs during shutdown

## 3. Skill Prompt (`SKILL.md`)

Optional natural-language guidance injected into the agent system prompt.

## Config (`adytum.config.yaml`)

Global skill controls:

```yaml
skills:
  enabled: true
  allow: []
  deny: []
  load:
    paths: []
  entries:
    my-skill:
      enabled: true
      config:
        someKey: someValue
```

- `skills.entries.<id>.config` is passed to `api.pluginConfig`.
- `skills.load.paths` allows loading plugins outside `workspace/skills`.
