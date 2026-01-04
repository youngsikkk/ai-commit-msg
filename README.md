# AI Commit Message Generator

Generate meaningful commit messages automatically using AI. Analyzes your staged changes and creates [Conventional Commits](https://www.conventionalcommits.org/) formatted messages in seconds.

![VS Code](https://img.shields.io/badge/VS%20Code-1.107%2B-blue?logo=visualstudiocode)
![License](https://img.shields.io/badge/License-MIT-green)
![OpenAI](https://img.shields.io/badge/Powered%20by-OpenAI-412991?logo=openai)

---

## Features

- **Auto-generate commit messages** from staged changes using OpenAI
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
3. Enter your OpenAI API key when prompted (first time only)
4. The generated message appears in the Source Control input box
5. Review and commit!

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aiCommit.model` | string | `gpt-4o-mini` | OpenAI model to use |
| `aiCommit.maxDiffChars` | number | `12000` | Maximum diff characters to send to AI |
| `aiCommit.exclude` | array | `["node_modules", "*.lock", ...]` | Glob patterns to exclude from diff |

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
- **OpenAI API key** ([Get one here](https://platform.openai.com/api-keys))

---

## Security

Your OpenAI API key is stored securely using VS Code's [SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage). It is never exposed in settings, logs, or transmitted anywhere except to OpenAI's API.

To update your API key, run "AI Commit: Set API Key" from the Command Palette.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Happy committing!**
