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

- **Multi-provider support** - Choose from OpenAI, Groq, Google Gemini, or **Ollama (offline)**
- **3 commit message candidates** - Pick the best one from AI-generated options
- **PR description generation** - Auto-generate structured PR descriptions from your changes
- **Issue linking** - Auto-detect issue numbers from branch names (GitHub, GitLab, JIRA)
- **Korean language support** - Generate commit messages in Korean
- **Conventional Commits format** for consistent, semantic versioning friendly messages
- **Sensitive information masking** - Automatically masks API keys, passwords, tokens before sending to AI
- **Smart diff summarization** - AI summarizes large diffs for better commit messages
- **Team ruleset support** - Enforce commit conventions via `.commitrc.json`
- **Multi-repo workspace support** with repository picker
- **Secure API key storage** using VS Code's built-in SecretStorage
- **Configurable exclusions** to filter out noise from diffs (lock files, build artifacts, etc.)
- **Smart handling** of existing commit messages (overwrite/append options)

---

## What's New in v0.2.0

### Ollama Support (Offline Mode)
Run AI commit message generation completely offline using local LLMs via Ollama. No API key required!

### Sensitive Information Masking
Automatically detects and masks sensitive data before sending to AI:
- API keys (OpenAI, AWS, GitHub, Stripe, etc.)
- Passwords and secrets in config files
- Connection strings and tokens
- Private keys

### Smart Diff Summarization
For large diffs (>8000 chars by default), the extension first summarizes the changes using AI, then generates commit messages from the summary for better results.

### Team Ruleset Support
Create a `.commitrc.json` file in your project root to enforce team conventions:
- Allowed commit types and scopes
- Required scopes
- Max subject length
- Custom prompts for AI
- Language override

### PR Description Generation
Automatically generate well-structured PR descriptions with:
- Title (max 50 chars)
- Summary section
- Changes bullet list
- Testing instructions

Opens in a new editor tab with "Copy to Clipboard" option.

### Issue Linking
Automatically extract issue numbers from branch names and include them in commit messages:
- Configure `issueBranchPattern` to extract issue from branch (e.g., `feature/(\d+)` extracts `123` from `feature/123-login`)
- Configure `issuePrefix` to format the reference (e.g., `#` → `#123`)
- Works with GitHub, GitLab, JIRA, and custom issue systems

Example: Branch `feature/123-add-login` → Commit: `feat(auth): add login validation #123`

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
3. Enter your API key when prompted (first time only, not required for Ollama)
4. **Choose from 3 generated candidates** or click "Regenerate" for new options
5. The selected message appears in the Source Control input box
6. Review and commit!

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aiCommit.provider` | string | `openai` | AI provider: `openai`, `groq`, `gemini`, or `ollama` |
| `aiCommit.model` | string | (auto) | Model to use. Leave empty for provider defaults |
| `aiCommit.language` | string | `english` | Language: `english` or `korean` |
| `aiCommit.maxDiffChars` | number | `12000` | Maximum diff characters to send to AI |
| `aiCommit.exclude` | array | `[...]` | Glob patterns to exclude from diff |
| `aiCommit.ollamaUrl` | string | `http://localhost:11434` | Ollama server URL |
| `aiCommit.maskSensitiveInfo` | boolean | `true` | Mask sensitive info in diff before sending to AI |
| `aiCommit.summarizeLargeDiff` | boolean | `true` | Summarize large diffs before generating messages |
| `aiCommit.largeDiffThreshold` | number | `8000` | Character threshold for diff summarization |
| `aiCommit.issuePrefix` | string | `""` | Prefix for issue references (e.g., `#`, `JIRA-`) |
| `aiCommit.issueBranchPattern` | string | `""` | Regex to extract issue from branch name |

### Default Models by Provider

| Provider | Default Model |
|----------|---------------|
| OpenAI | `gpt-4o-mini` |
| Groq | `llama-3.1-8b-instant` |
| Gemini | `gemini-1.5-flash` |
| Ollama | `llama3.2` |

### Default Exclusions

```json
["node_modules", "*.lock", "dist", "build", "*.min.*"]
```

---

## Team Ruleset (.commitrc.json)

Create a `.commitrc.json` file in your project root to enforce team conventions:

```json
{
  "allowedTypes": ["feat", "fix", "docs", "refactor", "test"],
  "requireScope": true,
  "allowedScopes": ["api", "ui", "core", "config"],
  "maxSubjectLength": 72,
  "language": "english",
  "customPrompt": "Always mention the ticket number if visible in the diff"
}
```

### Ruleset Options

| Option | Type | Description |
|--------|------|-------------|
| `allowedTypes` | string[] | Restrict commit types (e.g., `["feat", "fix"]`) |
| `requireScope` | boolean | Require a scope in commit messages |
| `allowedScopes` | string[] | Restrict allowed scopes |
| `maxSubjectLength` | number | Maximum subject line length |
| `subjectPrefix` | string | Prefix to add to subject (e.g., ticket number) |
| `language` | string | Override language setting (`english` or `korean`) |
| `customPrompt` | string | Additional instructions for AI |

When a generated commit doesn't match the ruleset, you'll get options to:
- **Use Anyway** - Use the commit message as-is
- **Regenerate** - Generate new candidates
- **Cancel** - Abort the operation

---

## Ollama Setup

1. Install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull llama3.2`
3. Start Ollama (runs automatically on install)
4. Set provider to `ollama` in VS Code settings
5. (Optional) Set custom URL with `AI Commit: Set Ollama URL`

---

## Issue Linking Setup

Configure issue extraction from branch names:

### GitHub/GitLab Issues
```json
// settings.json
{
  "aiCommit.issuePrefix": "#",
  "aiCommit.issueBranchPattern": "feature/(\\d+)"
}
```
Branch `feature/123-add-login` → `#123`

### JIRA Issues
```json
{
  "aiCommit.issuePrefix": "",
  "aiCommit.issueBranchPattern": "(PROJ-\\d+)"
}
```
Branch `feature/PROJ-456-fix-bug` → `PROJ-456`

### Custom Pattern Examples

| Branch Pattern | Regex | Result |
|----------------|-------|--------|
| `feature/123-desc` | `feature/(\\d+)` | `123` |
| `JIRA-456-feature` | `(JIRA-\\d+)` | `JIRA-456` |
| `issue-789/fix` | `issue-(\\d+)` | `789` |
| `GH-101-bugfix` | `(GH-\\d+)` | `GH-101` |

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

## Commands

| Command | Description |
|---------|-------------|
| `AI Commit: Generate` | Generate commit message from staged changes |
| `AI Commit: Generate PR Description` | Generate PR description from uncommitted changes |
| `AI Commit: Set OpenAI API Key` | Set/update OpenAI API key |
| `AI Commit: Set Groq API Key` | Set/update Groq API key |
| `AI Commit: Set Gemini API Key` | Set/update Gemini API key |
| `AI Commit: Set Ollama URL` | Set custom Ollama server URL |

---

## Keybindings

| Command | Windows/Linux | Mac |
|---------|---------------|-----|
| AI Commit: Generate | `Ctrl+Shift+G` | `Cmd+Shift+G` |
| AI Commit: Generate PR Description | `Ctrl+Shift+R` | `Cmd+Shift+R` |

---

## Requirements

- **VS Code** 1.107.0 or higher
- **Git** installed and repository initialized
- **API key** for your chosen provider (not required for Ollama):
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Groq](https://console.groq.com/keys)
  - [Google AI Studio (Gemini)](https://aistudio.google.com/app/apikey)
  - [Ollama](https://ollama.ai/) (local, no API key needed)

---

## Security

Your API keys are stored securely using VS Code's [SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage). They are never exposed in settings, logs, or transmitted anywhere except to the respective AI provider's API.

**Sensitive Information Masking** (enabled by default) automatically detects and masks:
- API keys (OpenAI, AWS, GitHub, Stripe, Google, Azure, etc.)
- Passwords and secrets in configuration files
- Database connection strings
- JWT tokens and bearer tokens
- Private keys (RSA, SSH, PGP)

This ensures your sensitive data is never sent to AI providers.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Happy committing!**
