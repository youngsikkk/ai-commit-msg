# CommitCraft CLI

Generate AI-powered commit messages from your terminal.

## Installation

```bash
npm install -g commitcraft-cli
```

Or use with npx:

```bash
npx commitcraft-cli
```

## Quick Start

1. Stage your changes:
```bash
git add .
```

2. Generate commit message:
```bash
commitcraft
```

3. Select from 3 AI-generated options:
```
? Select a commit message:
❯ 1. feat(auth): add OAuth2 login support
  2. feat(auth): implement authentication flow
  3. feat: add social login feature
  Cancel
```

4. The selected message is copied to your clipboard!

## Usage

### Generate commit message (default command)

```bash
commitcraft
# or
commitcraft generate
```

### Auto-commit with selected message

```bash
commitcraft --commit
# or
commitcraft -c
```

### Specify provider and options

```bash
commitcraft -p openai -m gpt-4 -l english
commitcraft -p groq
commitcraft -p ollama -m llama3.2
```

### Configure API keys

```bash
commitcraft config
```

## Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--provider` | `-p` | AI provider: `openai`, `groq`, `gemini`, `ollama` |
| `--model` | `-m` | Specific model to use |
| `--language` | `-l` | Language: `english` or `korean` |
| `--commit` | `-c` | Auto-commit with selected message |
| `--issue-pattern` | | Regex to extract issue from branch |
| `--issue-prefix` | | Prefix for issue (e.g., `#`) |

## Configuration

### Environment Variables

```bash
export OPENAI_API_KEY="sk-..."
export GROQ_API_KEY="gsk_..."
export GEMINI_API_KEY="AI..."
export OLLAMA_URL="http://localhost:11434"
```

### Config File (~/.commitcraftrc)

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "language": "english",
  "openaiApiKey": "sk-...",
  "groqApiKey": "gsk_...",
  "geminiApiKey": "AI..."
}
```

### .env File

You can also use a `.env` file in your project or home directory:

```
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
COMMITCRAFT_PROVIDER=openai
COMMITCRAFT_LANGUAGE=english
```

## Issue Linking

Extract issue numbers from branch names:

```bash
# Branch: feature/123-add-login
commitcraft --issue-pattern "feature/(\d+)" --issue-prefix "#"
# Result: feat(auth): add login validation #123
```

```bash
# Branch: JIRA-456-fix-bug
commitcraft --issue-pattern "(JIRA-\d+)"
# Result: fix(api): resolve null pointer JIRA-456
```

## Providers

### OpenAI (default)
- Default model: `gpt-4o-mini`
- Requires: `OPENAI_API_KEY`
- Get key: https://platform.openai.com/api-keys

### Groq
- Default model: `llama-3.1-8b-instant`
- Requires: `GROQ_API_KEY`
- Get key: https://console.groq.com/keys
- Fast and free tier available

### Gemini
- Default model: `gemini-1.5-flash`
- Requires: `GEMINI_API_KEY`
- Get key: https://aistudio.google.com/app/apikey

### Ollama (Local/Offline)
- Default model: `llama3.2`
- No API key required
- Install: https://ollama.ai/
- Run: `ollama pull llama3.2`

## Examples

### Basic usage

```bash
$ git add src/auth.ts
$ commitcraft

✓ Got staged changes
✓ Generated commit messages

? Select a commit message:
❯ 1. feat(auth): add password validation
  2. feat(auth): implement input validation for login
  3. feat: add authentication validation
  Cancel

✓ Copied to clipboard: feat(auth): add password validation
```

### Auto-commit

```bash
$ commitcraft --commit

✓ Got staged changes
✓ Generated commit messages

? Select a commit message: 1. feat(auth): add password validation
✓ Committed: feat(auth): add password validation
```

### Korean language

```bash
$ commitcraft -l korean

✓ Got staged changes
✓ Generated commit messages

? Select a commit message:
❯ 1. feat(auth): 비밀번호 유효성 검사 추가
  2. feat(auth): 로그인 입력값 검증 구현
  3. feat: 인증 유효성 검사 추가
  Cancel
```

## Supported Commit Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting |
| `refactor` | Code refactoring |
| `perf` | Performance |
| `test` | Tests |
| `build` | Build system |
| `ci` | CI/CD |
| `chore` | Maintenance |

## License

MIT
