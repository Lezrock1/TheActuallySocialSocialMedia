import { useState } from "react";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import { readPageBackground, savePageBackground } from "../lib/pageBackground.js";
import type { PageBackgroundPreference, PageSurface } from "../lib/pageBackground.js";
import { btnSecondary, card } from "../lib/ui.js";

const surfaces: { id: PageSurface; label: string }[] = [
  { id: "feed", label: "All pages" },
  { id: "chat", label: "Messages" },
];

export default function BackgroundSettings() {
  const [backgrounds, setBackgrounds] = useState<Record<PageSurface, PageBackgroundPreference>>(() => ({
    feed: readPageBackground("feed"),
    chat: readPageBackground("chat"),
  }));
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<PageSurface | null>(null);

  function update(surface: PageSurface, preference: PageBackgroundPreference) {
    setBackgrounds((current) => ({ ...current, [surface]: preference }));
    savePageBackground(surface, preference);
  }

  async function selectImage(surface: PageSurface, file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(surface);
    try {
      const imageKey = await uploadMedia(file);
      update(surface, { ...backgrounds[surface], imageKey });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload this background.");
    } finally {
      setUploading(null);
    }
  }

  return (
    <section className={`${card} mb-4`}>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">Appearance</h2>
        <p className="mt-1 text-xs text-gray-500">Personal backgrounds for this browser.</p>
      </div>
      <div className="divide-y divide-gray-100">
        {surfaces.map(({ id, label }) => {
          const preference = backgrounds[id];
          return (
            <div key={id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-20 flex-1">
                <p className="text-sm font-medium text-gray-800">{label}</p>
                {preference.imageKey && (
                  <img src={mediaUrl(preference.imageKey)} alt="" className="mt-2 h-12 w-20 rounded-md object-cover" />
                )}
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                Color
                <input
                  type="color"
                  aria-label={`${label} background color`}
                  value={preference.color}
                  onChange={(event) => update(id, { ...preference, color: event.target.value })}
                  className="h-9 w-11 cursor-pointer rounded border border-gray-200 bg-white p-1"
                />
              </label>
              <label className={`${btnSecondary} relative min-h-9 cursor-pointer px-3 text-xs`}>
                {uploading === id ? "Uploading…" : preference.imageKey ? "Change image" : "Add image"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading !== null}
                  onChange={(event) => {
                    void selectImage(id, event.target.files?.[0]);
                    event.target.value = "";
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={`${label} background image`}
                />
              </label>
              {preference.imageKey && (
                <button
                  type="button"
                  onClick={() => update(id, { ...preference, imageKey: null })}
                  className="min-h-9 px-2 text-xs font-medium text-gray-500 hover:text-gray-900"
                >
                  Remove image
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}