---
name: email-calendar
description: Unified Gmail and Google Calendar operations for inbox triage, message retrieval, email sending, event management, and cross-domain planning from email-to-calendar context. Use when tasks involve email and calendar coordination.
---

# Email + Calendar (Google Workspace)

Use this skill when work requires reading emails and coordinating schedules in one workflow.

## What It Can Do

- Read inbox messages with Gmail query filters
- Fetch full message details by message id
- Send emails (guarded by confirmation + write permission)
- List calendar events in a time window
- Create calendar events and optional Meet links (guarded by confirmation + write permission)
- Build a daily briefing from both inbox and calendar
- Create meetings directly from a source email context

## Tools

- `email_calendar_list_messages`
- `email_calendar_get_message`
- `email_calendar_send_message`
- `email_calendar_list_events`
- `email_calendar_create_event`
- `email_calendar_daily_briefing`
- `email_calendar_create_meeting_from_message`

## Setup

Provide OAuth credentials via skill config or environment variables:

- `ADYTUM_EMAIL_CALENDAR_ACCESS_TOKEN` (required unless refresh flow is configured)
- `ADYTUM_EMAIL_CALENDAR_REFRESH_TOKEN` (optional, recommended)
- `ADYTUM_EMAIL_CALENDAR_CLIENT_ID` (required for refresh flow)
- `ADYTUM_EMAIL_CALENDAR_CLIENT_SECRET` (required for refresh flow)

Required Google scopes:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send` (only if sending emails)
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/calendar.events` (only if creating/updating events)

For a practical OAuth setup flow, see `references/google-oauth-setup.md`.

## Config Example

```yaml
skills:
  entries:
    email-calendar:
      enabled: true
      config:
        provider: google
        defaultCalendarId: primary
        defaultTimezone: America/New_York
        defaultUnreadQuery: 'in:inbox is:unread newer_than:7d'
        allowWriteActions: false
```

## Safety Rules

- Keep `allowWriteActions: false` until credentials and behavior are verified.
- For send/create tools, pass `confirm: true` only when user intent is explicit.
- Use preview output first (the tools return `requires_confirmation` without `confirm: true`).

## Recommended Workflows

1. Daily planning:

- Call `email_calendar_daily_briefing`
- Review `signals.meetingCandidates`
- Convert needed messages using `email_calendar_create_meeting_from_message`

2. Message-driven scheduling:

- Call `email_calendar_get_message`
- Decide date/time with user
- Call `email_calendar_create_meeting_from_message` with `confirm: true`

3. Follow-up communication:

- Call `email_calendar_create_event` with `confirm: true`
- Send follow-up using `email_calendar_send_message` with `confirm: true`
