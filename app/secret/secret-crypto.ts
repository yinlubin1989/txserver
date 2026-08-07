const PREFIX = "密笺·1·";
const VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;
const PBKDF2_ITERATIONS = 310_000;
const ADDITIONAL_DATA = new TextEncoder().encode("密笺/v1");

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertWebCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前浏览器不支持安全加密，请改用最新版 Chrome、Safari 或 Edge。");
  }
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("这段文字不是有效的密笺密文。");
  }

  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + padding;

  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("这段文字不是有效的密笺密文。");
  }
}

async function deriveKey(password: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(password)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMessage(message: string, password: string) {
  assertWebCrypto();

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(ADDITIONAL_DATA),
        tagLength: TAG_LENGTH,
      },
      key,
      toArrayBuffer(new TextEncoder().encode(message)),
    ),
  );

  const payload = new Uint8Array(1 + SALT_LENGTH + IV_LENGTH + encrypted.length);
  payload[0] = VERSION;
  payload.set(salt, 1);
  payload.set(iv, 1 + SALT_LENGTH);
  payload.set(encrypted, 1 + SALT_LENGTH + IV_LENGTH);

  return PREFIX + encodeBase64Url(payload);
}

export async function decryptMessage(sealedMessage: string, password: string) {
  assertWebCrypto();

  const normalized = sealedMessage.trim();
  if (!normalized.startsWith(PREFIX)) {
    throw new Error("这段文字不是密笺生成的密文，请检查是否复制完整。");
  }

  const payload = decodeBase64Url(normalized.slice(PREFIX.length));
  const minimumLength = 1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH / 8;

  if (payload.length < minimumLength || payload[0] !== VERSION) {
    throw new Error("密文版本不受支持，或内容已经损坏。");
  }

  const salt = payload.slice(1, 1 + SALT_LENGTH);
  const iv = payload.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
  const encrypted = payload.slice(1 + SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(ADDITIONAL_DATA),
        tagLength: TAG_LENGTH,
      },
      key,
      toArrayBuffer(encrypted),
    );

    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  } catch {
    throw new Error("解密失败：口令不对，或密文已被改动。");
  }
}

export function generatePassword(length = 24) {
  assertWebCrypto();

  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!@#";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
}
