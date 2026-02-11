---
name: discord
description: Comprehensive Discord skill for inbound and outbound messaging.
metadata:
  {
    "communication": true,
    "requires": { "env": ["ADYTUM_DISCORD_BOT_TOKEN"] },
    "primaryEnv": "ADYTUM_DISCORD_BOT_TOKEN"
  }
---

# Discord Skill

Use this skill whenever a task involves Discord messaging, reading message history, reactions, polls, threads, or Discord channel/guild discovery.

## Tools

- `discord_send`
  - Quick send helper for channel/thread/DM.
  - Args: `content` (required), plus optional `channelId`, `threadId`, `userId`, `replyToMessageId`.

- `discord_action`
  - Advanced action router.
  - `action` values:
    - `send_message`
    - `read_messages`
    - `fetch_message`
    - `react`
    - `create_poll`
    - `create_thread`
    - `reply_thread`
    - `create_channel`
    - `pin_message`
    - `unpin_message`
    - `list_channels`
    - `list_guilds`
    - `guild_info`
    - `list_members`

## Targeting

- Use `target` when convenient:
  - `channel:<id>`
  - `thread:<id>`
  - `user:<id>`
- For message links (`https://discord.com/channels/.../.../...`), use `action: fetch_message` with `messageLink`.
- Defaults come from config/env:
  - channel: `defaultChannelId` or `ADYTUM_DISCORD_DEFAULT_CHANNEL_ID`
  - user DM: `defaultUserId` or `ADYTUM_DISCORD_DEFAULT_USER_ID`
  - guild: `guildId` or `ADYTUM_DISCORD_GUILD_ID`

## Behavior

- Prefer `discord_send` for simple "send this" requests.
- Use `discord_action` for operations that need reads/reactions/polls/threads/discovery.
- Use `discord_action` with `action: list_guilds` when user asks "which servers are accessible".
- If no target is provided, the skill falls back to `defaultChannelId`; if missing, it will try `defaultUserId` for a DM.
- For `create_channel`, prefer configured default guild (`guildId` / `ADYTUM_DISCORD_GUILD_ID`) and only ask for guild ID if no guild can be resolved.
- If no default guild is configured, call `list_guilds` first and let user pick by name/ID instead of asking blindly for raw guild ID.
- Respect `skills.entries.discord.config.actionPermissions.*`; if an action is disabled, ask user to enable it in dashboard Skills page.
- Keep channel messages concise.
- Reply in public channels if only necessary or you are mentioned or someone replied into your previous message/thread.
- Always try to adapat your personality based on the individual channel.
- Only use numeric snowflake IDs; if an ID is redacted or non-numeric, re-read from config/env/secrets and do not pull IDs from memories or logs.
