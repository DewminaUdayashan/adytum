# 🌌 Adytum

### The Intelligence Layer for your Digital Workspace

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Adytum is a **self-hosted, autonomous AI agent** that lives in your local machine. Unlike standard chatbots, Adytum is designed to be proactive—managing your files, scheduling your tasks, and connecting your digital world through a robust **Skill System**.

---

## 🏛️ Core Philosophy

Adytum isn't just a tool—it's a **digital companion**.

- **Your AI Buddy**: Think of Adytum as a pet or a sidekick that lives in your computer. It's not just a command-line utility; it has a presence.
- **Independent Personality**: As it works with you, Adytum builds its own personality (defined in `SOUL.md`). It doesn't just reply; it _thinks_, _reflects_, and _grows_ alongside you.
- **Proactive Autonomy**: It doesn't wait for orders. Adytum independently manages its own goals (`HEARTBEAT.md`), organizes its memory, and suggests actions to help you be more productive.
- **Privacy Centric**: Your data stays where it belongs—on your machine. Use Local LLMs (Ollama) for maximum privacy.

---

## 🚀 One-Click Setup (Mac/Linux)

The fastest way to get Adytum up and running is our zero-config setup script:

1.  **Clone the Repository**:

    ```bash
    git clone https://github.com/dewminaudayashan/adytum.git
    cd adytum
    ```

2.  **Run the Installer**:

    ```bash
    sh install.sh
    ```

    _This script will install dependencies, build the ecosystem, and guide you through the **Birth Protocol** (initial configuration)._

3.  **Start the Ecosystem**:
    ```bash
    adytum start
    ```
    _This will launch the AI Gateway, the Web Dashboard, and open your browser automatically to `http://localhost:3002`._

---

## 🛠️ CLI Reference

Adytum comes with a powerful global CLI to manage your agent from any terminal.

| Command         | Description                                               |
| :-------------- | :-------------------------------------------------------- |
| `adytum init`   | Re-run the Birth Protocol to configure keys and settings. |
| `adytum start`  | Launch the Gateway + Dashboard and open the browser.      |
| `adytum update` | Pull latest patches from Git and rebuild everything.      |
| `adytum status` | Check system health, token usage, and active models.      |
| `adytum reset`  | **DANGER**: Wipes all configuration and local memory.     |

---

## 🧩 The Skill System

Adytum is as smart as you make it. Use the **Dashboard** to manage your agent's capabilities.

### Adding Skills

- **Instructions**: Drop a folder with a `SKILL.md` file into the `skills/` directory.
- **Plugins**: Create functional plugins with `adytum.plugin.json` to integrate with external APIs.

### Configuring Skills

1.  Navigate to the **Skills** page in the Dashboard.
2.  Select a skill to see its documentation.
3.  Set its **Secrets** (API Keys, tokens) directly in the UI. They are stored securely in your local `.env` file.

---

## 🤖 Model Management

Optimize your agent's performance by tailoring its "brain" to your needs:

- **Thinking**: High-intelligence models (Claude 3.5 Sonnet, GPT-4o) for complex tasks.
- **Fast**: Lean, cheap models (GPT-4o-mini, Gemini Flash) for status updates and summarization.
- **Local**: Private models (Ollama/Llama3) for sensitive data.

Use the **Models** page in the Dashboard to test connections and switch active roles instantly.

---

## 🏗️ Technical Stack

- **Monorepo**: Managed with NPM Workspaces.
- **Backend**: Node.js + Fastify + WebSocket.
- **Frontend**: Next.js 15 + React + Tailwind CSS.
- **Agent Logic**: ReAct loop with Retrieval-Augmented Generation (RAG).
- **LLM Integration**: Provider-agnostic via `@mariozechner/pi-ai`.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
