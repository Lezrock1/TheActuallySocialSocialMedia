import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { TRANSLATION_LANGUAGES } from "@app/shared";
import type { ExternalFeedPost, TranslationLanguage } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import LinkedMentions from "./LinkedMentions.js";

export default function PostTranslation({ post }: { post: ExternalFeedPost }) {
  const { data: preferences } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: () => apiFetch<{ translationLanguage: TranslationLanguage }>("/users/me/preferences"),
  });
  const language = preferences?.translationLanguage ?? "de";
  const label = TRANSLATION_LANGUAGES.find((option) => option.code === language)?.label ?? "Deutsch";
  const [result, setResult] = useState<{ language: string; text: string } | null>(null);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const translation = result?.language === language ? result.text : null;

  async function translate() {
    if (translation) {
      setVisible((value) => !value);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await apiFetch<{ translation: string }>("/ai/translate", {
        method: "POST",
        body: JSON.stringify({ externalPost: { platform: post.platform, externalId: post.externalId, url: post.url } }),
      });
      setResult({ language, text: response.translation });
      setVisible(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not translate this post.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" disabled={pending} onClick={() => void translate()} aria-expanded={visible && !!translation}
        className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50">
        {pending ? "Translating..." : visible && translation ? "Hide translation" : `Translate to ${label}`}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error} <Link to="/settings/ai" className="underline">AI Tools</Link></p>}
      {visible && translation && <div className="mt-2 border-l-2 border-blue-300 pl-3">
        <p className="mb-1 text-[10px] font-semibold uppercase text-gray-400">{label}</p>
        <p className="whitespace-pre-wrap text-[15px] leading-snug [overflow-wrap:anywhere]"><LinkedMentions text={translation} linksOnly /></p>
      </div>}
    </div>
  );
}