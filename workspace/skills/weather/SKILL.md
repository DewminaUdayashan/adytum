# Weather

Use this skill when users ask about current weather or short forecasts.

## Tools

- `weather_current`
  - Get current weather conditions.
  - Args:
    - `location` (optional if default location is configured)
    - `units` (`metric` or `us`)

- `weather_forecast`
  - Get forecast for up to 3 days.
  - Args:
    - `location` (optional if default location is configured)
    - `units` (`metric` or `us`)
    - `days` (`1..3`)

## Behavior

- If user does not specify location, use configured `defaultLocation`.
- If no location is available, ask for location clearly.
- Keep response concise and practical.
- Mention units in final response (C/F and km/h or mph).

## Data Sources

- `wttr.in` (primary)
- `open-meteo.com` (fallback)
- No API key is required.
