import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const DEVELOPMENT_CUSTOMER_DATA_KEY =
  "operations-kit-development-customer-data-key";

function secretMaterial() {
  return (
    process.env.OPERATIONS_KIT_CUSTOMER_DATA_KEY ||
    process.env.SHOPIFY_API_SECRET ||
    DEVELOPMENT_CUSTOMER_DATA_KEY
  );
}

function key(material = secretMaterial()) {
  return createHash("sha256").update(material).digest();
}

function decryptKeys() {
  return Array.from(
    new Set(
      [
        process.env.OPERATIONS_KIT_CUSTOMER_DATA_KEY,
        process.env.SHOPIFY_API_SECRET,
        DEVELOPMENT_CUSTOMER_DATA_KEY,
      ].filter(Boolean) as string[],
    ),
  ).map((material) => key(material));
}

export function encryptCustomerData(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptCustomerData(value?: string | null) {
  if (!value) return null;
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== VERSION || !iv || !tag || !encrypted) return null;

  let lastError: unknown = null;
  for (const candidateKey of decryptKeys()) {
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        candidateKey,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));

      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to decrypt customer data.");
}

export function safeDecryptCustomerData(value?: string | null) {
  if (!value) return null;
  try {
    return decryptCustomerData(value);
  } catch {
    return null;
  }
}

export function hashCustomerLookup(...parts: Array<string | null | undefined>) {
  const normalized = parts
    .map((part) => part?.trim().toLowerCase())
    .filter(Boolean)
    .join("|");
  if (!normalized) return "unknown-customer";

  return createHmac("sha256", key()).update(normalized).digest("hex");
}
