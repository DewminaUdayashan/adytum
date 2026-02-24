---
name: whatsapp
description: Send WhatsApp messages and search chat history via the wacli CLI.
homepage: https://wacli.sh
metadata:
  {
    'emoji': '📱',
    'requires': { 'bins': ['wacli'] },
    'install':
      [
        {
          'id': 'brew',
          'kind': 'brew',
          'formula': 'steipete/tap/wacli',
          'bins': ['wacli'],
          'label': 'Install wacli (brew)',
        },
      ],
  }
---

# WhatsApp

This skill allows me to interact with WhatsApp via the `wacli` command-line interface. I can send text messages, group messages, and search through chat history.

## Support

- Sending text messages to individual contacts.
- Sending messages to groups.
- Searching chats and messages.
- Listing active chats.

## Prerequisites

- `wacli` must be installed on the system.
- Initial setup and authentication must be done via `wacli auth` in the terminal.

## Usage

Use this skill when you need to contact someone on WhatsApp or find information from WhatsApp conversations.
Direct chats: `<number>@s.whatsapp.net`
Groups: `<id>@g.us`
