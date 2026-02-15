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

Dashboard OAuth flow uses:

- Authorization endpoint: `https://accounts.google.com/o/oauth2/v2/auth`
- Redirect URI: `http://localhost:3000/api/skills/email-calendar/oauth/google/callback` (or your dashboard base URL + this path)
- Account label: required in Skills Dashboard when connecting each Google account.

## 3. Store Credentials

Set environment variables (recommended):

```bash
export ADYTUM_EMAIL_CALENDAR_ACCESS_TOKEN="ya29..."
export ADYTUM_EMAIL_CALENDAR_REFRESH_TOKEN="1//..."
export ADYTUM_EMAIL_CALENDAR_CLIENT_ID="..."
export ADYTUM_EMAIL_CALENDAR_CLIENT_SECRET="..."
export ADYTUM_GOOGLE_OAUTH_CLIENT_ID="..." # optional global fallback for dashboard connect
export ADYTUM_GOOGLE_OAUTH_CLIENT_SECRET="..." # optional global fallback
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
