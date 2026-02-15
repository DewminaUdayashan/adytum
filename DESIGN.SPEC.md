# Adytum Landing Page Design Spec

Use this document as the single source of truth for generating the Adytum marketing/landing page with AI.

## 1. Product Definition

### Product name

Adytum

### One-line positioning

A self-hosted autonomous AI agent that runs on your machine, uses your models, and extends itself through skills.

### Short description

Adytum is a terminal-first, self-hosted AI agent ecosystem with a real-time dashboard, model-agnostic routing, tool execution, and a pluggable skill system.

---

## 🏛️ Core Philosophy

Adytum isn't just a tool—it's a **digital companion**.

- **Your AI Buddy**: Think of Adytum as a pet or a sidekick that lives in your computer. It's not just a command-line utility; it has a presence.
- **Independent Personality**: As it works with you, Adytum builds its own personality (defined in `SOUL.md`). It doesn't just reply; it _thinks_, _reflects_, and _grows_ alongside you.
- **Proactive Autonomy**: It doesn't wait for orders. Adytum independently manages its own goals (`HEARTBEAT.md`), organizes its memory, and suggests actions to help you be more productive.
- **Privacy Centric**: Your data stays where it belongs—on your machine. Use Local LLMs (Ollama) for maximum privacy.

---

### Core promise

- You keep control of data and runtime.
- You choose models and providers.
- You can extend capabilities with skills.
- You can observe everything the agent does.

## 3. Brand and Messaging Pillars

### Pillar 1: Self-hosted control

“Your agent lives on your machine, not in a black-box SaaS.”

### Pillar 2: Autonomous but observable

“Agent can act proactively, and every action is visible in real time.”

### Pillar 3: Model-agnostic intelligence

“Use cloud or local models, routed by role and fallback chains.”

### Pillar 4: Extensible skill ecosystem

“Add capabilities via skill folders and plugin manifests.”

### Pillar 5: Security-conscious runtime

“Path validation, approval flow, and audit logs built in.”

## 4. Tone and Voice

- As the user requested
- Learns from your interactions
- Reflects on its own actions

### Headline options

- “Your Self-Hosted AI Agent, Running on Your Terms.”
- “Autonomous AI for Your Workspace. Local, Observable, Extensible.”

### Subheadline

Adytum is a terminal-first AI agent with a real-time dashboard, model routing, memory, and skills. Self-host it, customize it, and watch every action live.

### Primary CTA

- “Get Started”

### Secondary CTA

- “Read Developer Docs”

### Hero proof bullets

- Self-hosted runtime
- Works with cloud and local models
- Skill/plugin architecture
- Live console and audit trail

## Section B: Why Adytum (Problem/Solution)

### Problem statement

Most AI assistants are opaque SaaS products: limited control, unclear behavior, and hard-to-extend workflows.

### Solution statement

Adytum gives you an inspectable runtime with explicit model routing, tool calls, memory, and extensibility through skills.

## Section C: Core Features Grid

Use 6 cards minimum:

1. Terminal-First Agent Runtime
2. Real-Time Dashboard
3. Model Routing and Fallback Chains
4. Skill System (Instruction + Plugin)
5. Security and Approval Controls
6. Persistent Memory and Token Analytics

Feature details:

### Terminal-First Agent Runtime

- Interactive CLI lifecycle (`init`, `start`, `status`, `reset`).
- ReAct-style loop: think, call tools, observe, respond.
- Proactive behavior support via scheduled jobs.

### Real-Time Dashboard

- Live stream of thoughts, tool calls, results, and responses.
- Chat UI connected to gateway WebSocket.
- Pages for skills, tokens, settings, personality, permissions, tasks.

### Model Routing and Fallback Chains

- Roles: `thinking`, `fast`, `local`.
- Task-level overrides and chain fallback behavior.
- LiteLLM proxy mode + direct provider mode.

### Skill System

- Discover skills from `workspace/skills` and managed paths.
- Plugin skills via `adytum.plugin.json` + `index.ts`.
- Instruction-only skills via `SKILL.md`.
- Runtime load diagnostics (enabled/disabled/error/missing requirements).

### Security and Approval Controls

- Workspace path validation + sensitive path blocking.
- Dynamic permission entries with modes and expirations.
- Manual approval flow for risky actions.
- Audit events for traceability.

### Persistent Memory and Token Analytics

- Local message + memory persistence.
- Memory categories and retrieval in prompt context.
- Token usage tracking by provider/model/day.
- Usage surfaced via API and dashboard charts.

## Section D: Architecture Snapshot

Show a simplified architecture diagram.

### Diagram content

- User -> CLI/Dashboard -> Gateway
- Gateway -> Agent Runtime -> Model Router -> Providers
- Gateway -> Tool Registry
- Gateway -> Skill Loader
- Gateway -> Local Storage (SQLite + config/secrets)

### Supporting copy

Single backend orchestrates runtime, model calls, skills, and observability while keeping data local by default.

## Section E: Skill Ecosystem Deep Dive

### Headline

“Teach Your Agent New Capabilities with Skills”

### Content blocks

- Skill types: plugin and instruction-only.
- Manifest schema support (`configSchema`, `metadata.requires`, `uiHints`).
- Hot reload when files change.
- API endpoints for skill management and secrets.

### Example skill ideas

- Weather lookup
- Notion workspace operations
- Discord messaging connector
- Web search and surf tools
- OS-specific reminder integrations

## Section F: Privacy and Security

### Key points

- Self-hosted deployment and local workspace boundaries.
- Path validation and sensitive path protection.
- Approval workflow for high-risk operations.
- Audit stream for what happened and why.

### Compliance-style note

No “zero-risk” claims. State that users remain responsible for environment hardening and secret handling policy.

## Section G: Quick Start

Include install flow exactly:

```bash
git clone https://github.com/dewminaudayashan/adytum.git
cd adytum
sh install.sh
adytum start
```

Also show routes:

- Gateway: `http://localhost:3001`
- Dashboard: `http://localhost:3002`

## Section H: Developer CTA

### Headline

“Build Your Own Agent Capabilities”

### Body

Use the architecture and skill docs to add tools, APIs, and domain-specific skills.

### CTA links

- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/SKILL_DEVELOPMENT_GUIDE.md`
- `DEV.README.md`

## Section I: FAQ

Include at least these FAQs:

1. Is Adytum cloud-only?
2. Can I use local models?
3. How do skills work?
4. Can I see what the agent is doing?
5. Does it require PostgreSQL?
6. Can I control dangerous actions?

## Section J: Final CTA + Footer

### Final CTA

- Primary: “Run Adytum Locally”
- Secondary: “Explore the Docs”

### Footer items

- GitHub repository
- License (MIT)
- Documentation links

## 7. Content Library (Reusable Copy Snippets)

### Hero snippet

Self-host an autonomous AI agent with transparent reasoning, tool execution, and a pluggable skill system.

### Security snippet

Adytum layers path validation, permission policies, approval workflows, and audit logging to make agent actions inspectable and controllable.

### Skill snippet

Skills are modular capability packs: register tools/services with plugin manifests or provide instruction-only behavior with markdown.

### Model snippet

Route workloads across cloud and local models using role-based chains and fallback policies.

## 8. Visual Direction for AI Generation

### Style

- Modern technical product aesthetic.
- Clean, high-contrast layout.
- Subtle gradients and glass panels allowed, but keep readability high.
- Desktop-first with strong mobile responsiveness.

### Color direction

- Base: near-black / charcoal or clean light neutral (choose one coherent theme).
- Accent: electric cyan, teal, or blue-green (avoid purple-heavy defaults).
- Semantic status colors for success/warning/error badges.

### Typography

- Strong display font for hero headline.
- Highly legible sans-serif for body content.
- Monospace for CLI code snippets.

### Component style

- Feature cards with icon + title + concise explanation.
- Sticky top navigation with section anchors.
- Code blocks with syntax highlighting.
- CTA buttons with clear primary/secondary contrast.

## 9. Required UI Components

- Header/nav
- Hero section with dual CTA
- Feature grid
- Architecture diagram block
- Skills deep-dive section
- Security section
- Quick-start code block
- FAQ accordion
- Final CTA/footer

## 10. Trust and Proof Elements

Add these visible proof elements:

- “Self-hosted” badge
- “Open source” badge
- “MIT License” badge
- “Model-agnostic” badge
- Local runtime ports snippet (`3001`, `3002`)

Optional proof elements:

- Command examples (`adytum init`, `adytum start`)
- Screenshot placeholders for dashboard pages

## 11. SEO Metadata Spec

### Title

Adytum - Self-Hosted Autonomous AI Agent with Skills and Real-Time Observability

### Meta description

Adytum is a self-hosted AI agent platform with terminal-first workflows, real-time dashboard, model routing, security controls, and a pluggable skill system.

### Keywords

self-hosted ai agent, autonomous ai assistant, local ai agent, agent runtime, ai skills plugin system, model routing, terminal ai assistant

## 12. Do and Don’t Rules for Page Generation

### Do

- Keep claims grounded in implemented capabilities.
- Highlight self-hosting and observability repeatedly.
- Show concrete workflow snippets and architecture visuals.
- Make skill extensibility a first-class section.

### Don’t

- Don’t claim enterprise compliance certifications unless explicitly available.
- Don’t claim zero risk or fully autonomous safety guarantees.
- Don’t present Adytum as cloud-only.
- Don’t hide setup commands behind generic marketing copy.

## 13. Suggested Landing Page Outline (Compact)

1. Hero
2. Problem -> Solution
3. Features grid
4. Architecture snapshot
5. Skills ecosystem
6. Security and control
7. Quick start code
8. FAQ
9. Final CTA/footer

## 14. Output Requirements for AI Page Generator

When using this spec to generate the landing page, require:

- Fully responsive HTML/CSS/JS (or React/Next.js section components)
- Accessible semantic markup
- Syntax-highlighted code blocks
- Copy-to-clipboard on command/code examples
- Optional light/dark mode only if it does not reduce readability
- Modular sections that can be reordered

## 15. Canonical Reference Docs

The generated page should stay aligned with:

- `README.md`
- `DEV.README.md`
- `docs/ARCHITECTURE.md`
- `docs/GATEWAY_RUNTIME.md`
- `docs/SKILL_SYSTEM.md`
- `docs/SKILL_DEVELOPMENT_GUIDE.md`
