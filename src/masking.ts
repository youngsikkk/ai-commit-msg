/**
 * Masks sensitive information in diff content before sending to AI.
 */

interface MaskPattern {
  pattern: RegExp;
  replacement: string;
}

const MASK_PATTERNS: MaskPattern[] = [
  // Private keys (PEM format)
  {
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/gi,
    replacement: '[PRIVATE_KEY]'
  },

  // OpenAI API keys
  {
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: '[OPENAI_API_KEY]'
  },

  // Groq API keys
  {
    pattern: /gsk_[a-zA-Z0-9]{20,}/g,
    replacement: '[GROQ_API_KEY]'
  },

  // AWS Access Key IDs
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[AWS_ACCESS_KEY]'
  },

  // AWS Secret Access Keys (40 character base64)
  {
    pattern: /(?<=aws_secret_access_key\s*[=:]\s*["']?)[A-Za-z0-9/+=]{40}(?=["']?)/gi,
    replacement: '[AWS_SECRET_KEY]'
  },

  // Google API keys
  {
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    replacement: '[GOOGLE_API_KEY]'
  },

  // GitHub tokens
  {
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    replacement: '[GITHUB_TOKEN]'
  },

  // Generic API key patterns in assignments
  {
    pattern: /(?<=(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*["']?)[a-zA-Z0-9_\-]{16,}(?=["']?)/gi,
    replacement: '[API_KEY]'
  },

  // Bearer tokens
  {
    pattern: /(?<=Bearer\s+)[a-zA-Z0-9_\-\.]{20,}/gi,
    replacement: '[BEARER_TOKEN]'
  },

  // JWT tokens (three base64 parts separated by dots)
  {
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    replacement: '[JWT_TOKEN]'
  },

  // Generic token patterns in assignments
  {
    pattern: /(?<=(?:access[_-]?token|auth[_-]?token|token)\s*[=:]\s*["']?)[a-zA-Z0-9_\-]{20,}(?=["']?)/gi,
    replacement: '[TOKEN]'
  },

  // Password patterns in assignments
  {
    pattern: /(?<=(?:password|passwd|pwd|pass)\s*[=:]\s*["']?)[^"'\s\n]{4,}(?=["']?)/gi,
    replacement: '[PASSWORD]'
  },

  // Secret patterns in assignments
  {
    pattern: /(?<=(?:secret|secret[_-]?key|client[_-]?secret)\s*[=:]\s*["']?)[a-zA-Z0-9_\-]{8,}(?=["']?)/gi,
    replacement: '[SECRET]'
  },

  // Connection strings - MongoDB
  {
    pattern: /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
    replacement: '[MONGODB_CONNECTION_STRING]'
  },

  // Connection strings - PostgreSQL
  {
    pattern: /postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
    replacement: '[POSTGRES_CONNECTION_STRING]'
  },

  // Connection strings - MySQL
  {
    pattern: /mysql:\/\/[^\s"'<>]+/gi,
    replacement: '[MYSQL_CONNECTION_STRING]'
  },

  // Connection strings - Redis
  {
    pattern: /redis(?:s)?:\/\/[^\s"'<>]+/gi,
    replacement: '[REDIS_CONNECTION_STRING]'
  },

  // Connection strings - Generic database
  {
    pattern: /(?:jdbc|odbc):\/\/[^\s"'<>]+/gi,
    replacement: '[DATABASE_CONNECTION_STRING]'
  },

  // Private IP addresses with credentials
  {
    pattern: /(?<=:\/\/)[^:]+:[^@]+@(?=\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g,
    replacement: '[CREDENTIALS]@'
  },

  // Slack webhooks
  {
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
    replacement: '[SLACK_WEBHOOK]'
  },

  // Discord webhooks
  {
    pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g,
    replacement: '[DISCORD_WEBHOOK]'
  },

  // Stripe API keys
  {
    pattern: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g,
    replacement: '[STRIPE_SECRET_KEY]'
  },
  {
    pattern: /pk_(?:live|test)_[0-9a-zA-Z]{24,}/g,
    replacement: '[STRIPE_PUBLISHABLE_KEY]'
  },

  // Twilio credentials
  {
    pattern: /SK[0-9a-fA-F]{32}/g,
    replacement: '[TWILIO_API_KEY]'
  },

  // SendGrid API keys
  {
    pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g,
    replacement: '[SENDGRID_API_KEY]'
  },

  // Mailgun API keys
  {
    pattern: /key-[0-9a-zA-Z]{32}/g,
    replacement: '[MAILGUN_API_KEY]'
  },

  // npm tokens
  {
    pattern: /npm_[A-Za-z0-9]{36}/g,
    replacement: '[NPM_TOKEN]'
  },

  // Heroku API keys
  {
    pattern: /(?<=HEROKU_API_KEY\s*[=:]\s*["']?)[0-9a-fA-F-]{36}(?=["']?)/gi,
    replacement: '[HEROKU_API_KEY]'
  },

  // SSH private key content (base64 encoded lines)
  {
    pattern: /(?<=-----BEGIN[^-]+-----\n)([A-Za-z0-9+/=\n]+)(?=\n-----END)/g,
    replacement: '[KEY_CONTENT_REDACTED]'
  }
];

/**
 * Masks sensitive information in the provided text.
 * @param text The text to mask (typically a git diff)
 * @returns The text with sensitive information replaced by placeholders
 */
export function maskSensitiveInfo(text: string): string {
  let masked = text;

  for (const { pattern, replacement } of MASK_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }

  return masked;
}

/**
 * Checks if the text contains any potentially sensitive information.
 * @param text The text to check
 * @returns true if sensitive patterns are detected
 */
export function containsSensitiveInfo(text: string): boolean {
  return MASK_PATTERNS.some(({ pattern }) => {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
