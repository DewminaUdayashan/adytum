# Browser Control

Use this skill when the task requires controlling a real browser session, interacting with page elements, or extracting in-page data from live websites across macOS, Linux, or Windows.

## Tools

- `browser_open`
  - Open a URL in Chromium/Chrome/Edge/Firefox/WebKit.
  - Returns page snapshot fields (`title`, `url`, `readyState`, short text preview).

- `browser_click`
  - Click an element by CSS selector on the active tab.
  - Use after opening a page or when navigating interactive UI.

- `browser_type`
  - Type into a field selected by CSS selector.
  - Supports optional clear + optional submit.

- `browser_eval`
  - Execute custom JavaScript in page context.
  - Use `mode="expression"` for simple reads (for example `document.title`).
  - Use `mode="function"` for statement blocks and `return` a structured object.

- `browser_extract`
  - Extract page data in one of: `text`, `html`, `links`, `forms`.
  - Optional `selector` scopes extraction to a specific section.

- `browser_close`
  - Close one session or all sessions created by this skill.

## Operating Pattern

1. Start with `browser_open` for target URL.
2. Use `browser_extract mode="text"` or `mode="links"` to map the page quickly.
3. Use `browser_click` and `browser_type` for navigation and form flow.
4. Use `browser_eval` for custom DOM reads/actions that the standard tools do not cover.
5. Re-run `browser_extract` (or `browser_eval`) to verify resulting page state.

## Constraints

- Requires Playwright runtime (`playwright` package) and browser engines.
- Install once per environment:
  1. `npm install playwright`
  2. `npx playwright install chromium firefox webkit`
- Default behavior is headed (visible browser window). Toggle `headless` from the dashboard skill config when needed.
- For Linux desktopless environments, use `headless=true` or run with a virtual display.
- `browser_eval` runs arbitrary page JavaScript; use only task-relevant scripts and avoid unsafe actions.
