const secretKeyPattern = /(api[-_]?key|authorization|password|secret|token|cookie)/i;

export function redactSecrets(value: unknown, secrets: readonly string[] = []): unknown {
  const presentSecrets = secrets.filter((secret) => secret.length >= 4);
  if (typeof value === "string") {
    return presentSecrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, presentSecrets));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = secretKeyPattern.test(key) ? "[REDACTED]" : redactSecrets(child, presentSecrets);
    }
    return result;
  }
  return value;
}

export function loggerOptions(level: string): Record<string, unknown> {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.xi-api-key",
        "request.headers.authorization",
        "request.headers.cookie",
        "request.headers.xi-api-key",
        "*.apiKey",
        "*.api_key",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
  };
}
