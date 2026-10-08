const PEAK_COUNT = 48;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface EncryptedVoice {
  file: File;
  key: string;
  iv: string;
}

// Encrypts a recording in the browser; key and IV only ever travel inside the encrypted chat message.
export async function encryptAudioBlob(blob: Blob): Promise<EncryptedVoice> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await blob.arrayBuffer());
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const type = normalizeAudioType(blob.type);
  return {
    file: new File([ciphertext], "voice.bin", { type }),
    key: toBase64(rawKey),
    iv: toBase64(iv),
  };
}

export async function decryptAudioBlob(
  ciphertext: Blob,
  key: string,
  iv: string,
  type: string
): Promise<Blob> {
  const cryptoKey = await crypto.subtle.importKey("raw", fromBase64(key), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, cryptoKey, await ciphertext.arrayBuffer());
  return new Blob([plain], { type });
}

// The server only accepts bare audio types; the real type is stored in the voice message.
export function normalizeAudioType(type: string): string {
  const base = type.split(";")[0].trim().toLowerCase();
  return base.startsWith("audio/") ? base : "audio/webm";
}

export async function computePeaks(blob: Blob): Promise<number[]> {
  try {
    const AudioContextClass = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return [];
    const context = new AudioContextClass();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const channel = decoded.getChannelData(0);
      const size = Math.max(1, Math.floor(channel.length / PEAK_COUNT));
      const peaks: number[] = [];
      for (let index = 0; index < PEAK_COUNT; index += 1) {
        let max = 0;
        for (let sample = index * size; sample < Math.min(channel.length, (index + 1) * size); sample += 1) {
          max = Math.max(max, Math.abs(channel[sample]));
        }
        peaks.push(max);
      }
      const top = Math.max(...peaks, 0.001);
      return peaks.map((peak) => Math.round((peak / top) * 100) / 100);
    } finally {
      void context.close();
    }
  } catch {
    return [];
  }
}
