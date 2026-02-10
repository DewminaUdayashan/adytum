# Adytum — Developer Guide

## Prerequisites

- Node.js 18+
- Docker (optional — for LiteLLM proxy and PostgreSQL)
- At least one LLM API key **or** a local model runner (Ollama / LM Studio)

## Setup

```bash
# Install dependencies
npm install

# Build all packages (order matters)
npm run build -w packages/shared
npm run build -w packages/gateway
```

## Environment Variables

Create a `.env` file in the project root with at least one API key:

```env
# Pick one or more:
GOOGLE_API_KEY=your-google-key          # Gemini models
ANTHROPIC_API_KEY=sk-ant-...            # Claude models
OPENAI_API_KEY=sk-...                   # GPT models
OPENROUTER_API_KEY=sk-or-...            # 200+ models via OpenRouter
GROQ_API_KEY=gsk_...                    # Fast inference (Llama, Mixtral)
TOGETHER_API_KEY=...                    # Open-source models
DEEPSEEK_API_KEY=sk-...                 # DeepSeek models
XAI_API_KEY=xai-...                     # Grok models

# No key needed for local:
# - Ollama (http://localhost:11434)
# - LM Studio (http://localhost:1234)
```

## Running the CLI

### First-time setup (Birth Protocol)

```bash
node packages/gateway/dist/cli/index.js init
```

This walks you through naming your agent, selecting models, and generates:
- `adytum.config.yaml` — main config
- `litellm_config.yaml` — proxy config (optional)
- `workspace/SOUL.md` — agent personality
- `workspace/HEARTBEAT.md` — agent goals

### Start the gateway

```bash
node packages/gateway/dist/cli/index.js start
```

Or equivalently:

```bash
node packages/gateway/dist/index.js start
```

You should see:

```
  Starting Adytum...

  ✓ Storage: sqlite
  ✓ Tools: 6 registered
  ✓ LLM: Direct API mode: thinking→google/gemini-2.0-flash, fast→google/gemini-2.0-flash, local→ollama/llama3.3
  ✓ Agent: Adytum loaded
  ✓ Gateway: http://localhost:3001

  Adytum is awake. Type your message below.
  Adytum >
```

### Other CLI commands

```bash
# Check if gateway is running
node packages/gateway/dist/cli/index.js status

# List installed skills
node packages/gateway/dist/cli/index.js skill list
```

### REPL commands (inside the chat)

| Command    | Action                              |
| ---------- | ----------------------------------- |
| `exit`     | Shut down the gateway               |
| `/clear`   | Reset conversation context          |
| `/status`  | Show token usage and connection count |
| `/reload`  | Reload SOUL.md and skills from disk |

## Development Workflow

### Watch mode (auto-rebuild on changes)

```bash
# Terminal 1 — rebuild shared on change
cd packages/shared && npx tsc --watch

# Terminal 2 — rebuild gateway on change
cd packages/gateway && npx tsc --watch

# Terminal 3 — run the CLI
node packages/gateway/dist/cli/index.js start
```

### Running the dashboard

```bash
npm run dev -w packages/dashboard
# Opens on http://localhost:3000
# Proxies API calls to gateway on :3001
```

## Test Prompts

Use these to verify each subsystem is working:

### Basic conversation

```
What is 2 + 2?
```

> Should respond without any tool calls — pure LLM response.

### File system tools

```
What files are in the current directory?
```

> Should use `shell_execute` with `ls` or similar.

```
Read the contents of package.json
```

> Should use `file_read` tool and return the file contents.

```
Write "hello world" to workspace/test.txt
```

> Should use `file_write` tool (may ask for approval).

### Security boundary

```
Read the file /etc/passwd
```

> **Should be blocked** by the path validator — only workspace files are allowed.

```
Run rm -rf /
```

> **Should be blocked** or require explicit approval.

### Shell execution

```
What version of Node.js is installed?
```

> Should use `shell_execute` with `node --version`.

```
Show me the git log for this project
```

> Should use `shell_execute` with `git log --oneline` (requires approval).

### Web fetch

```
Fetch the contents of https://httpbin.org/get
```

> Should use `web_fetch` tool and return the response.

### Multi-step reasoning

```
Create a new file called workspace/fibonacci.py that contains a function to calculate the nth Fibonacci number, then read it back and verify it looks correct.
```

> Should chain multiple tool calls: `file_write` → `file_read` → respond.

### Context and memory

```
My name is Alice and I'm working on a React project.
```

Then later:

```
What's my name and what am I working on?
```

> Should remember from earlier in the conversation.

### Token tracking

After a few interactions, type:

```
/status
```

> Should show non-zero token counts and estimated cost.

### SOUL.md personality

```
Who are you? What's your personality like?
```

> Should reflect whatever is written in `workspace/SOUL.md`.

## Testing the Dashboard

Start both the gateway and dashboard:

```bash
# Terminal 1
node packages/gateway/dist/cli/index.js start

# Terminal 2
npm run dev -w packages/dashboard
```

Then visit:

| Page                            | What to check                                     |
| ------------------------------- | ------------------------------------------------- |
| http://localhost:3000            | Activity feed — shows agent actions after chatting |
| http://localhost:3000/console    | Live console — green "Connected" indicator         |
| http://localhost:3000/chat       | Chat interface — send a message                   |
| http://localhost:3000/tokens     | Token stats — non-zero after chatting              |
| http://localhost:3000/permissions| Permission grant/revoke form                      |
| http://localhost:3000/personality| SOUL.md editor with diff preview                  |
| http://localhost:3000/heartbeat  | Goal manager                                      |

## Troubleshooting

### "All models failed" error

- Check your API key is set in `.env`
- Run `echo $GOOGLE_API_KEY` (or whichever provider) to verify
- Try a local model: `ollama run llama3.2`

### "EADDRINUSE: address already in use"

```bash
# Kill whatever is on port 3001
lsof -ti :3001 | xargs kill -9
```

### "No adytum.config.yaml found"

Run `node packages/gateway/dist/cli/index.js init` first.

### Gateway starts but LLM calls fail silently

Run with debug mode:

```bash
DEBUG=1 node packages/gateway/dist/cli/index.js start
```

### Dashboard can't connect to gateway

Make sure the gateway is running on `:3001` before starting the dashboard on `:3000`.
