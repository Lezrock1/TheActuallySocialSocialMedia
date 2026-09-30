import type { AiMode } from "@app/shared";

const FACTCHECK_SYSTEM_PROMPT =
  "Du bist ein sorgfältiger FactCheck-Assistent für eine Social-Media-Plattform. " +
  "Dir wird der Kontext eines Posts gegeben (Autor, Datum, Text). Identifiziere " +
  "überprüfbare Tatsachenbehauptungen, bewerte ihre Richtigkeit nach bestem Wissen, " +
  "weise auf fehlenden Kontext oder Nuancen hin, und kennzeichne Unsicherheit klar, " +
  "wenn du dir nicht sicher bist. Antworte prägnant, neutral und unabhängig von " +
  "politischer Ausrichtung. Antworte in der Sprache des Posts.";

const EXPLAIN_SYSTEM_PROMPT =
  "Du bist ein hilfreicher Assistent, der Social-Media-Posts einordnet und " +
  "erklärt: Fachbegriffe, Anspielungen, historischer oder gesellschaftlicher " +
  "Hintergrund, der zum Verständnis nötig ist. Antworte prägnant, neutral, " +
  "lehrreich und in der Sprache des Posts.";

const CUSTOM_BASE_SYSTEM_PROMPT =
  "Du bist ein Assistent innerhalb einer Social-Media-Plattform und hilfst einem " +
  "Nutzer, einen bestimmten Post einzuordnen. Dir wird der Kontext des Posts " +
  "gegeben, sowie eine eigene Anweisung/Frage des Nutzers dazu. Folge der " +
  "Anweisung des Nutzers so gut wie möglich, bezogen auf den gegebenen Post.";

export const FACTCHECK_SUMMARY_SYSTEM_PROMPT =
  "Du bekommst mehrere unabhängige FactCheck-Ergebnisse zum selben Social-Media-Post " +
  "von verschiedenen Nutzern (ggf. mit unterschiedlichen KI-Modellen erstellt). " +
  "Fasse sie in 1-3 prägnanten, neutralen Sätzen zusammen: worin stimmen sie überein, " +
  "worin unterscheiden sie sich. Keine Wiederholung der einzelnen Ergebnisse, nur die " +
  "Essenz. Antworte in der Sprache der Ergebnisse.";

export function systemPromptForMode(mode: AiMode): string {
  switch (mode) {
    case "factcheck":
      return FACTCHECK_SYSTEM_PROMPT;
    case "explain":
      return EXPLAIN_SYSTEM_PROMPT;
    case "custom":
      return CUSTOM_BASE_SYSTEM_PROMPT;
  }
}

export interface PostContext {
  authorUsername: string;
  authorDisplayName: string | null;
  createdAt: Date;
  text: string | null;
  hasImage: boolean;
}

export function buildPostContextBlock(post: PostContext): string {
  const lines = [
    "Kontext des Posts:",
    `Autor: @${post.authorUsername}${post.authorDisplayName ? ` (${post.authorDisplayName})` : ""}`,
    `Gepostet am: ${post.createdAt.toISOString()}`,
    `Text: "${post.text ?? "(kein Text)"}"`,
  ];
  if (post.hasImage) {
    lines.push("Hinweis: Der Post enthält außerdem ein Bild (für dich nicht sichtbar).");
  }
  return lines.join("\n");
}

export function buildInitialUserMessage(
  mode: AiMode,
  post: PostContext,
  customPrompt?: string
): string {
  const context = buildPostContextBlock(post);
  if (mode === "custom") {
    return `${context}\n\nAnfrage des Nutzers: ${customPrompt}`;
  }
  return context;
}
