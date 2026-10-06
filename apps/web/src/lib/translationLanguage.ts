const supportedLanguages = ["deu", "eng", "spa", "fra", "ita", "por", "nld", "pol"];

export async function detectPostLanguage(text: string): Promise<string> {
  const { franc } = await import("franc-min");
  return franc(text, { minLength: 20, only: supportedLanguages });
}