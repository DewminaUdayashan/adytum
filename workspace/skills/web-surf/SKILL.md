# Web Surf Skill

Use this skill when the agent must discover sources on its own, not only fetch known URLs.

## Tools

- `web_search`
  - Finds ranked links for a query.
  - Use this first when user asks "find", "latest", "what sources", "research", etc.

- `web_fetch_page`
  - Fetches a single URL and extracts readable text.
  - Use this for targeted reads of a known source.

- `web_surf`
  - End-to-end research flow: rotates search queries, gathers links, opens pages, and returns combined evidence + citations.
  - Prefer this for multi-source questions.

## How To Operate

- Start with `web_surf` when user asks open-ended web research.
- Use `web_search` for quick link discovery or when user wants source options first.
- Use `web_fetch_page` to drill deeper into a specific citation.
- Respect configured budgets:
  - rotations
  - pages opened
  - extraction chars (rough token burn)
- Cite URLs from returned `citations` when answering.
- If evidence conflicts or is sparse, say so explicitly.

## Safety

- Respect `safeDomains` and `blockedDomains` policies.
- Avoid bypassing domain restrictions.
- Do not attempt local/private network fetches if blocked by config.
