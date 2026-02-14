---
name: web-search
description: Lightweight web search and surf using DuckDuckGo (no API key) or Serper (Google, requires API key).
metadata: { 'communication': false, 'requires': { 'bins': [] }, 'install': [] }
---

# Web Search

Use this skill to search the web and optionally fetch the top result pages.

## Tools

- `web_search` – search the web and return titles/URLs/snippets.
  - Args: `query` (string, required), `maxResults` (default from config), `provider` (`duckduckgo`|`serper`).
- `web_surf` – search then fetch page text for top results; respects token budget.
  - Args: `query`, `maxResults`, `rotations` (how many pages to fetch), `maxTokens`.

## Providers

- `duckduckgo` (default): no API key needed.
- `serper`: set `apiKey` in skill config to use Google results.

## Usage notes

- Keep queries concise; prefer `web_surf` when you need snippets of page content.
- Token budget is approximate; skill truncates page content to stay within budget.
