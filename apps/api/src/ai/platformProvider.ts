export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const PLATFORM_AI_LABEL = "InTouch AI";

export interface PlatformOpenAi {
  apiKey?: string;
  model?: string;
}

interface ProviderShape {
  type: string;
  baseUrl: string;
  model: string;
}

export function platformOpenAiEnabled(platform: PlatformOpenAi): boolean {
  return Boolean(platform.apiKey && platform.model);
}

// A provider that points at OpenAI with the server's model uses the shared key when it has no key of its own.
export function isPlatformOpenAiConfig(config: ProviderShape, platform: PlatformOpenAi): boolean {
  return (
    platformOpenAiEnabled(platform) &&
    config.type === "openai_compatible" &&
    config.baseUrl.replace(/\/$/, "") === OPENAI_BASE_URL &&
    config.model === platform.model
  );
}

// Users may not create or edit a provider into one that silently borrows the shared key.
export function mayBorrowPlatformKey(
  next: ProviderShape,
  hasOwnKey: boolean,
  existing: (ProviderShape & { hasOwnKey: boolean }) | null,
  platform: PlatformOpenAi
): boolean {
  if (hasOwnKey || !isPlatformOpenAiConfig(next, platform)) return true;
  const unchanged = existing !== null && !existing.hasOwnKey &&
    existing.type === next.type && existing.baseUrl === next.baseUrl && existing.model === next.model;
  return unchanged;
}
