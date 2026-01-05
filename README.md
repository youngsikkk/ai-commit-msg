# AI Commit Message Generator

Generate meaningful commit messages automatically using AI. Analyzes your staged changes and creates [Conventional Commits](https://www.conventionalcommits.org/) formatted messages in seconds.

![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/youngsikkk.oai-commit-mesg-gen-ius-Generator)
![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/youngsikkk.oai-commit-mesg-gen-ius-Generator)
![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/youngsikkk.oai-commit-mesg-gen-ius-Generator)
![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/youngsikkk.oai-commit-mesg-gen-ius-Generator)

![VS Code](https://img.shields.io/badge/VS%20Code-1.107%2B-blue?logo=visualstudiocode)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

- **Multi-provider support** - Choose from OpenAI, Groq, or Google Gemini
- **3 commit message candidates** - Pick the best one from AI-generated options
- **Korean language support** - Generate commit messages in Korean
- **Conventional Commits format** for consistent, semantic versioning friendly messages
- **Multi-repo workspace support** with repository picker
- **Secure API key storage** using VS Code's built-in SecretStorage
- **Configurable exclusions** to filter out noise from diffs (lock files, build artifacts, etc.)
- **Smart handling** of existing commit messages (overwrite/append options)

---

## Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "AI Commit Message Generator"
4. Click **Install**

---

## Usage

1. Stage your changes with `git add`
2. Run the command:
   - Press `Ctrl+Shift+G` (Windows/Linux) or `Cmd+Shift+G` (Mac)
   - Or open Command Palette (`Ctrl+Shift+P`) and type "AI Commit: Generate"
3. Enter your API key when prompted (first time only)
4. **Choose from 3 generated candidates** or click "Regenerate" for new options
5. The selected message appears in the Source Control input box
6. Review and commit!

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aiCommit.provider` | string | `openai` | AI provider: `openai`, `groq`, or `gemini` |
| `aiCommit.model` | string | (auto) | Model to use. Leave empty for provider defaults |
| `aiCommit.language` | string | `english` | Language: `english` or `korean` |
| `aiCommit.maxDiffChars` | number | `12000` | Maximum diff characters to send to AI |
| `aiCommit.exclude` | array | `[...]` | Glob patterns to exclude from diff |

### Default Models by Provider

| Provider | Default Model |
|----------|---------------|
| OpenAI | `gpt-4o-mini` |
| Groq | `llama-3.1-8b-instant` |
| Gemini | `gemini-1.5-flash` |

### Default Exclusions

```json
["node_modules", "*.lock", "dist", "build", "*.min.*"]
```

---

## Supported Commit Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, semicolons, etc.) |
| `refactor` | Code refactoring |
| `perf` | Performance improvements |
| `test` | Adding or updating tests |
| `build` | Build system or dependencies |
| `ci` | CI/CD configuration |
| `chore` | Other changes (maintenance, tooling) |

---

## Keybindings

| Command | Windows/Linux | Mac |
|---------|---------------|-----|
| AI Commit: Generate | `Ctrl+Shift+G` | `Cmd+Shift+G` |

---

## Requirements

- **VS Code** 1.107.0 or higher
- **Git** installed and repository initialized
- **API key** for your chosen provider:
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Groq](https://console.groq.com/keys)
  - [Google AI Studio (Gemini)](https://aistudio.google.com/app/apikey)

---

## Security

Your API keys are stored securely using VS Code's [SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage). They are never exposed in settings, logs, or transmitted anywhere except to the respective AI provider's API.

To update your API key:
- `AI Commit: Set OpenAI API Key`
- `AI Commit: Set Groq API Key`
- `AI Commit: Set Gemini API Key`

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Happy committing!**
