---
name: WhatsApp
description: Native WhatsApp skill for Adytum to send and receive messages without an official API.
---

# WhatsApp Skill (Native)

This skill allows the Adytum agent to interact directly with WhatsApp using the WhatsApp Web protocol (via `baileys`). It does not require a Business API or Twilio; instead, you link it as a "Linked Device" just like WhatsApp Web on your computer.

## Features

- **Inbound Messaging**: The agent can listen to incoming messages from WhatsApp users (and optionally groups) and reply intelligently.
- **Outbound Messaging**: Proactively send text, images, and documents.
- **No API Fees**: Uses your existing personal or business account.
- **Privacy**: Messaging happens through your own linked device session.

## Setup Instructions

### 1. Enable the Skill

In the Adytum UI Dashboard, navigate to **Skills** > **WhatsApp** and ensure it is **Enabled**.

### 2. Scan the QR Code

Once enabled, Adytum will generate a QR code for linking.

1. Check your **Adytum Gateway terminal/logs**.
2. You will see a QR code printed in the console.
3. Open WhatsApp on your phone.
4. Go to **Settings** > **Linked Devices** > **Link a Device**.
5. Scan the QR code shown in the terminal.

### 3. Verification

Once scanned, the terminal will log `WhatsApp connection opened successfully!`. Adytum is now connected.

## Configuration Options

- **Respond to Groups**: Disabled by default. Enable it if you want the agent to participate in group chats.
- **Allowed Remote JIDs**: If you want to restrict the agent to only respond to specific phone numbers or groups, list their JIDs here (e.g., `1234567890@s.whatsapp.net`).
- **Session Persistence**: Session data is stored locally in `~/.adytum/data/sessions/whatsapp` by default, so you won't need to scan the QR code every time the gateway restarts.

> **Note**: To prevent being flagged for spam, avoid having the agent send a high volume of unsolicited messages. Always adhere to WhatsApp's Terms of Service.
