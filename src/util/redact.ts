/**
 * Redact sensitive fields from a request/response body for logging
 */
export function redactBody(body: any): any {
  if (!body || typeof body !== "object") return body;

  const sensitiveKeys = new Set([
    "authorization",
    "api_key",
    "apikey",
    "token",
    "password",
    "secret",
    "key",
  ]);

  function redact(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(redact);
    }
    if (obj && typeof obj === "object") {
      const result: any = {};
      for (const [k, v] of Object.entries(obj)) {
        const lowerK = k.toLowerCase();
        if (sensitiveKeys.has(lowerK) || lowerK.includes("key") || lowerK.includes("secret")) {
          result[k] = "[REDACTED]";
        } else if (k === "messages" || k === "input") {
          // Keep messages/input but redact any nested sensitive fields
          result[k] = redact(v);
        } else if (["content", "input", "messages", "reasoning", "tools", "tool_calls", "arguments"].includes(lowerK) || lowerK.includes("reasoning")) {
          // Prompt, response and tool payloads are never log-safe. Keep only
          // the shape of these fields so debug logging cannot persist content.
          result[k] = "[REDACTED_CONTENT]";
        } else {
          result[k] = redact(v);
        }
      }
      return result;
    }
    return obj;
  }

  return redact(body);
}

/**
 * Truncate a string for logging
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...[truncated]";
}
