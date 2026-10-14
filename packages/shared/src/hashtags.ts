export function normalizeHashtag(value: string): string {
  return value.replace(/^#/, "").normalize("NFC").toLowerCase();
}

export function extractHashtags(text: string): string[] {
  const withoutUrls = text.replace(/https?:\/\/[^\s<>]+|www\.[^\s<>]+/giu, " ");
  const matches = withoutUrls.matchAll(/(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,64})(?![\p{L}\p{N}_])/gu);
  return [...new Set([...matches].map((match) => normalizeHashtag(match[1])))];
}