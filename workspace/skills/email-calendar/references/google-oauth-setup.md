# Google OAuth Setup

Use this flow to obtain tokens for the `email-calendar` skill.

## 1. Create OAuth Credentials

1. Open Google Cloud Console and create/select a project.
2. Enable Gmail API and Google Calendar API.
3. Configure OAuth consent screen.
4. Create OAuth client credentials (Desktop App is simplest for local use).

## 2. Authorize Required Scopes

Use OAuth Playground or your own auth flow to request:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send` (if you need sending)
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/calendar.events` (if you need event creation)

## 3. Store Credentials

Set environment variables (recommended):

```bash
export ADYTUM_EMAIL_CALENDAR_ACCESS_TOKEN="ya29..."
export ADYTUM_EMAIL_CALENDAR_REFRESH_TOKEN="1//..."
export ADYTUM_EMAIL_CALENDAR_CLIENT_ID="..."
export ADYTUM_EMAIL_CALENDAR_CLIENT_SECRET="..."
```

Or store the same values under:

`skills.entries.email-calendar.config`

## 4. Enable Write Actions Only After Validation

Start with:

```yaml
allowWriteActions: false
```

After read-only checks succeed, change to:

```yaml
allowWriteActions: true
```

Then use `confirm: true` on send/create tools for explicit execution.
