import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRANSLATION_LANGUAGES } from "@app/shared";
import type { TranslationLanguage } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { card, input } from "../lib/ui.js";

interface UserPreferences {
  translationLanguage: TranslationLanguage;
}

async function fetchUserPreferences(): Promise<UserPreferences> {
  return apiFetch<UserPreferences>("/users/me/preferences");
}

export default function TranslationLanguageSettings() {
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: ["user-preferences"],
    queryFn: fetchUserPreferences,
  });
  const [language, setLanguage] = useState<TranslationLanguage>("de");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preferencesQuery.data) setLanguage(preferencesQuery.data.translationLanguage);
  }, [preferencesQuery.data]);

  async function onChange(value: TranslationLanguage) {
    setLanguage(value);
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<UserPreferences>("/users/me/preferences", {
        method: "PATCH",
        body: JSON.stringify({ translationLanguage: value }),
      });
      queryClient.setQueryData(["user-preferences"], updated);
    } catch (caught) {
      setLanguage(preferencesQuery.data?.translationLanguage ?? "de");
      setError(caught instanceof Error ? caught.message : "Could not save translation language.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`${card} mb-4`}>
      <h2 className="text-base font-semibold text-gray-900">Post translation</h2>
      <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-gray-800">
        Translate posts to
        <select
          value={language}
          onChange={(event) => void onChange(event.target.value as TranslationLanguage)}
          disabled={preferencesQuery.isLoading || saving}
          className={input}
        >
          {TRANSLATION_LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>{option.label}</option>
          ))}
        </select>
      </label>
      {saving && <p role="status" className="mt-2 text-xs text-gray-500">Saving…</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}