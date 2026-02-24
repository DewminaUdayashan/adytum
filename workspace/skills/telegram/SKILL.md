---
name: telegram
description: Integrated Telegram bot that allows the agent to communicate via Telegram, send messages, read history, and react to messages.
metadata:
  { 'emoji': '💬', 'requires': { 'env': ['ADYTUM_TELEGRAM_BOT_TOKEN'] }, 'communication': true }
---

# Telegram

This skill allows me to communicate through Telegram. I can send messages, read recent chat history, add reactions, and listen for incoming messages to respond to them automatically.

## Support

- Message sending to users, groups, and channels.
- Reading chat history.
- Pinning/Unpinning messages.
- Message reactions.
- Automated inbound response.

## Prerequisites

- A Telegram Bot Token from @BotFather.
- Setting the `ADYTUM_TELEGRAM_BOT_TOKEN` environment variable or configuring it in the dashboard.
