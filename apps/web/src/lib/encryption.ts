import type { EncryptedSnapPayload } from "@app/shared";

export interface PublicEncryptionKey {
  userId: string;
  fingerprint: string;
  publicKey: string;
}

export interface EncryptedMessagePayload {
  version: 1;
  iv: string;
  ciphertext: string;
  wrappedKeys: Record<string, string>;
}

export interface DeviceEncryptionKey {
  id: string;
  userId: string;
  fingerprint: string;
  publicKey: string;
  privateKey: CryptoKey;
}

const DATABASE_NAME = "intouch-encryption";
const STORE_NAME = "device-keys";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredKeys(userId: string): Promise<DeviceEncryptionKey[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
      request.onsuccess = () =>
        resolve((request.result as DeviceEncryptionKey[]).filter((key) => key.userId === userId));
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function storeKey(key: DeviceEncryptionKey): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function ensureDeviceEncryptionKey(userId: string): Promise<DeviceEncryptionKey> {
  const existing = await getStoredKeys(userId);
  if (existing.length > 0) return existing[0];

  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["encrypt", "decrypt"]
  )) as CryptoKeyPair;
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKeyBytes));
  const fingerprint = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key: DeviceEncryptionKey = {
    id: `${userId}:${fingerprint}`,
    userId,
    fingerprint,
    publicKey: toBase64(publicKeyBytes),
    privateKey: pair.privateKey,
  };
  await storeKey(key);
  return key;
}

export async function getDeviceEncryptionKeys(userId: string): Promise<DeviceEncryptionKey[]> {
  return getStoredKeys(userId);
}

async function wrapContentKey(
  rawContentKey: ArrayBuffer,
  recipients: PublicEncryptionKey[]
): Promise<Record<string, string>> {
  if (recipients.length === 0) throw new Error("No recipient encryption keys are available");
  const wrappedKeys: Record<string, string> = {};

  for (const recipient of recipients) {
    const recipientBytes = fromBase64(recipient.publicKey);
    const recipientDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", recipientBytes));
    const actualFingerprint = Array.from(recipientDigest, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    if (actualFingerprint !== recipient.fingerprint) {
      throw new Error("A recipient public key does not match its fingerprint");
    }
    const publicKey = await crypto.subtle.importKey(
      "spki",
      recipientBytes,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"]
    );
    const wrappedKey = await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      rawContentKey
    );
    wrappedKeys[recipient.fingerprint] = toBase64(new Uint8Array(wrappedKey));
  }

  return wrappedKeys;
}

async function unwrapContentKey(
  wrappedKeys: Record<string, string>,
  deviceKeys: DeviceEncryptionKey[]
): Promise<CryptoKey> {
  for (const deviceKey of deviceKeys) {
    const wrappedKey = wrappedKeys[deviceKey.fingerprint];
    if (!wrappedKey) continue;
    const rawContentKey = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      deviceKey.privateKey,
      fromBase64(wrappedKey)
    );
    return crypto.subtle.importKey(
      "raw",
      rawContentKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
  }
  throw new Error("This content was not encrypted for a key on this device");
}

export async function encryptSnap(
  image: File,
  text: string,
  recipients: PublicEncryptionKey[]
): Promise<{ encryptedImage: File; payload: EncryptedSnapPayload }> {
  if (text.length > 500) throw new Error("Snap captions must be 500 characters or fewer");
  const contentKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const rawContentKey = await crypto.subtle.exportKey("raw", contentKey);
  const imageIv = crypto.getRandomValues(new Uint8Array(12));
  const textIv = crypto.getRandomValues(new Uint8Array(12));
  const [encryptedImageBytes, encryptedTextBytes] = await Promise.all([
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv: imageIv },
      contentKey,
      await image.arrayBuffer()
    ),
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv: textIv },
      contentKey,
      new TextEncoder().encode(text)
    ),
  ]);
  const wrappedKeys = await wrapContentKey(rawContentKey, recipients);

  return {
    encryptedImage: new File([encryptedImageBytes], "snap.jpg", {
      type: image.type,
      lastModified: Date.now(),
    }),
    payload: {
      version: 1,
      imageIv: toBase64(imageIv),
      textIv: toBase64(textIv),
      encryptedText: toBase64(new Uint8Array(encryptedTextBytes)),
      wrappedKeys,
    },
  };
}

export async function decryptSnap(
  encryptedImage: Blob,
  payload: EncryptedSnapPayload,
  deviceKeys: DeviceEncryptionKey[]
): Promise<{ image: Blob; text: string }> {
  const contentKey = await unwrapContentKey(payload.wrappedKeys, deviceKeys);
  const [imageBytes, textBytes] = await Promise.all([
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.imageIv) },
      contentKey,
      await encryptedImage.arrayBuffer()
    ),
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.textIv) },
      contentKey,
      fromBase64(payload.encryptedText)
    ),
  ]);
  return {
    image: new Blob([imageBytes], { type: encryptedImage.type }),
    text: new TextDecoder().decode(textBytes),
  };
}

export async function encryptMessage(
  text: string,
  recipients: PublicEncryptionKey[]
): Promise<EncryptedMessagePayload> {
  if (recipients.length === 0) throw new Error("No recipient encryption keys are available");

  const contentKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const rawContentKey = await crypto.subtle.exportKey("raw", contentKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    contentKey,
    new TextEncoder().encode(text)
  );
  const wrappedKeys = await wrapContentKey(rawContentKey, recipients);

  return {
    version: 1,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    wrappedKeys,
  };
}

export async function decryptMessage(
  payload: EncryptedMessagePayload,
  deviceKeys: DeviceEncryptionKey[]
): Promise<string> {
  const contentKey = await unwrapContentKey(payload.wrappedKeys, deviceKeys);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) },
    contentKey,
    fromBase64(payload.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}