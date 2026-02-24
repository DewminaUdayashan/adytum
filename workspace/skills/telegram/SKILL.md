---
name: Telegram
description: Native Telegram skill for Adytum to send and receive messages.
---

# Telegram Skill

This skill allows the Adytum agent to interact directly with Telegram users and groups. It uses the `grammy` library to connect to the Telegram Bot API.

## Features

- **Inbound Messaging**: The agent can listen to incoming messages from a Telegram bot and reply intelligently.
- **Outbound Messaging**: The agent can proactively send text messages to users and chats via the `telegram_send` tool.
- **Advanced Actions**: The agent can send photos, documents, polls, and perform other advanced Telegram actions via the `telegram_action` tool.

## Setup Instructions

1. Talk to [BotFather](https://t.me/BotFather) on Telegram to create a new bot and obtain a Bot Token.
2. In the Adytum UI Dashboard, navigate to **Skills** > **Telegram**.
3. Enable the skill and paste the Bot Token.
4. Optionally, configure allowed Telegram user IDs or default chat IDs.
5. Save the configuration and the gateway will automatically connect the bot.
