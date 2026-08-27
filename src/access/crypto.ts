import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "sift_sk_";

/** Create a high-entropy local gateway secret. The plaintext is never persisted by the store. */
export function createAccessKeySecret(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAccessKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function accessKeyPrefix(secret: string): string {
  return secret.slice(0, TOKEN_PREFIX.length + 8);
}

export function accessKeyLast4(secret: string): string {
  return secret.slice(-4);
}

export function verifyAccessKey(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashAccessKey(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isLocalAccessKeySecret(secret: string): boolean {
  return secret.startsWith(TOKEN_PREFIX) && secret.length > TOKEN_PREFIX.length + 20;
}
