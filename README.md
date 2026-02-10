# Adytum

**Adytum** is a self-hosted, autonomous AI assistant ecosystem designed for developers and researchers who value privacy, auditability, and cinematic interaction.

![Adytum Genesis](https://raw.githubusercontent.com/placeholder/adytum/main/assets/genesis.gif)

## 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/user/adytum.git
   cd adytum
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Wake up the agent (Birth Protocol)**
   ```bash
   npx adytum init
   ```
   *Follow the cinematic prompts to name your agent and configure your models.*

4. **Start the ecosystem**
   ```bash
   npx adytum start
   ```

## ✨ Key Features

- **Birth Protocol**: A cinematic first-run experience where the agent "comes alive".
- **Zero-Setup Storage**: Automatically provisions PostgreSQL via Docker or falls back to SQLite.
- **Model-Agnostic**: Seamlessly switch between Anthropic, OpenAI, Ollama, and more via LiteLLM.
- **Self-Evolving Soul**: Agent maintains a `SOUL.md` file defining its personality and voice.
- **Heartbeat Autonomy**: Proactive goal generation and environment monitoring.
- **Real-time Dashboard**: Live observability of every thought and tool call.

## 🏗️ Architecture

Adytum is built as a TypeScript monorepo:

- **`packages/gateway`**: The core server handling WebSockets, sessions, and the agent runtime.
- **`packages/dashboard`**: A Next.js interface for observability and token analytics.
- **`packages/shared`**: Common types and protocol definitions.

## 📜 Documentation

- [Full Specification](./SPECIFICATION.md)
- [Soul Configuration](./workspace/SOUL.md)
- [Heartbeat Goals](./workspace/HEARTBEAT.md)

## ⚖️ License

MIT
