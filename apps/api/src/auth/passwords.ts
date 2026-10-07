import argon2 from "argon2";

export class BusyError extends Error {
  constructor() {
    super("Server is busy");
  }
}

const MAX_CONCURRENT = 4;
const MAX_QUEUED = 32;

let running = 0;
const waiting: (() => void)[] = [];

// Bounds how much CPU/memory password hashing can use at once. Excess work
// waits in a short queue; beyond that requests are rejected with BusyError.
async function gated<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_QUEUED) throw new BusyError();
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

const passwords = {
  hash: (password: string): Promise<string> => gated(() => argon2.hash(password)),
  verify: (hash: string, password: string): Promise<boolean> => gated(() => argon2.verify(hash, password)),
};

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real verification, so unknown accounts are not distinguishable by timing. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= passwords.hash("dummy-password-for-timing");
  await passwords.verify(await dummyHash, password).catch((error: unknown) => {
    if (error instanceof BusyError) throw error;
  });
}

export default passwords;
