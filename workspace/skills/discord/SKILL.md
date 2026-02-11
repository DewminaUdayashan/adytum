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

## Behavior

- Prefer `discord_send` for simple "send this" requests.
- Use `discord_action` for operations that need reads/reactions/polls/threads/discovery.
- Use `discord_action` with `action: list_guilds` when user asks "which servers are accessible".
- For `create_channel`, prefer configured default guild (`guildId` / `ADYTUM_DISCORD_GUILD_ID`) and only ask for guild ID if no guild can be resolved.
- If no default guild is configured, call `list_guilds` first and let user pick by name/ID instead of asking blindly for raw guild ID.
- Respect `skills.entries.discord.config.actionPermissions.*`; if an action is disabled, ask user to enable it in dashboard Skills page.
- Keep channel messages concise.
