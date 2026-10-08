import { useState } from "react";
import { mediaUrl, uploadMedia } from "../lib/upload.js";
import {
  DEFAULT_BACKGROUND,
  hasSavedPageBackground,
  PAGE_SURFACES,
  readBackgroundMode,
  readPageBackground,
  resetPageBackgrounds,
  saveBackgroundMode,
  savePageBackground,
} from "../lib/pageBackground.js";
import type {
  BackgroundKey,
  BackgroundMode,
  PageBackgroundPreference,
  PageSurface,
} from "../lib/pageBackground.js";
import { btnSecondary, card } from "../lib/ui.js";

const pageLabels: Record<PageSurface, string> = {
  feed: "Feed",
  snaps: "Snaps",
  messages: "Messages",
  alerts: "Alerts",
  profile: "Profiles",
  people: "People search",
  settings: "Settings",
  other: "Other pages",
};

const backgroundKeys: BackgroundKey[] = ["all", ...PAGE_SURFACES, "conversation"];

function readAllBackgrounds(): Record<BackgroundKey, PageBackgroundPreference> {
  return Object.fromEntries(backgroundKeys.map((key) => [key, readPageBackground(key)])) as Record<BackgroundKey, PageBackgroundPreference>;
}

export default function BackgroundSettings() {
  const [mode, setMode] = useState<BackgroundMode>(readBackgroundMode);
  const [backgrounds, setBackgrounds] = useState(readAllBackgrounds);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<BackgroundKey | null>(null);

  function update(surface: BackgroundKey, preference: PageBackgroundPreference) {
    setBackgrounds((current) => ({ ...current, [surface]: preference }));
    savePageBackground(surface, preference);
  }

  function changeMode(nextMode: BackgroundMode) {
    if (nextMode === mode) return;
    if (nextMode === "shared") update("all", backgrounds.feed);
    else {
      const inherited = backgrounds.all;
      const nextBackgrounds = { ...backgrounds };
      for (const surface of PAGE_SURFACES) {
        if (!hasSavedPageBackground(surface)) {
          nextBackgrounds[surface] = inherited;
          savePageBackground(surface, inherited);
        }
      }
      setBackgrounds(nextBackgrounds);
    }
    setMode(nextMode);
    saveBackgroundMode(nextMode);
  }

  async function selectImage(surface: BackgroundKey, file: File | undefined) {
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

  function renderBackgroundControl(surface: BackgroundKey, label: string) {
    const preference = backgrounds[surface];
    return (
      <div key={surface} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
        <div className="min-w-24 flex-1">
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
            onChange={(event) => update(surface, { ...preference, color: event.target.value })}
            className="h-9 w-11 cursor-pointer rounded border border-gray-200 bg-white p-1"
          />
        </label>
        <label className={`${btnSecondary} relative min-h-9 cursor-pointer px-3 text-xs`}>
          {uploading === surface ? "Uploading…" : preference.imageKey ? "Change image" : "Add image"}
          <input
            type="file"
            accept="image/*"
            disabled={uploading !== null}
            onChange={(event) => {
              void selectImage(surface, event.target.files?.[0]);
              event.target.value = "";
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={`${label} background image`}
          />
        </label>
        {preference.imageKey && (
          <button
            type="button"
            onClick={() => update(surface, { ...preference, imageKey: null })}
            className="min-h-9 px-2 text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            Remove image
          </button>
        )}
        <button
          type="button"
          onClick={() => update(surface, DEFAULT_BACKGROUND)}
          className="min-h-9 px-2 text-xs font-medium text-gray-500 hover:text-gray-900"
        >
          Reset to default
        </button>
      </div>
    );
  }

  function resetEverything() {
    resetPageBackgrounds();
    setBackgrounds(Object.fromEntries(backgroundKeys.map((key) => [key, DEFAULT_BACKGROUND])) as Record<BackgroundKey, PageBackgroundPreference>);
    setMode("shared");
    setError(null);
  }

  const pageControls = mode === "shared"
    ? [{ id: "all" as const, label: "All pages" }]
    : PAGE_SURFACES.map((id) => ({ id, label: pageLabels[id] }));

  return (
    <section className={`${card} mb-4`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Page backgrounds</h2>
          <p className="mt-1 text-xs text-gray-500">Choose one background for the whole app or customize individual areas.</p>
        </div>
        <button
          type="button"
          onClick={resetEverything}
          className="min-h-9 px-2 text-xs font-medium text-gray-500 hover:text-gray-900"
        >
          Reset all
        </button>
      </div>

      <div role="group" aria-label="Background mode" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
        <button
          type="button"
          aria-pressed={mode === "shared"}
          onClick={() => changeMode("shared")}
          className={`min-h-9 rounded-lg px-2 text-xs font-medium transition-colors ${mode === "shared" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
        >
          Same on all pages
        </button>
        <button
          type="button"
          aria-pressed={mode === "custom"}
          onClick={() => changeMode("custom")}
          className={`min-h-9 rounded-lg px-2 text-xs font-medium transition-colors ${mode === "custom" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
        >
          Customize pages
        </button>
      </div>

      <div className="divide-y divide-gray-100">
        {pageControls.map(({ id, label }) => renderBackgroundControl(id, label))}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <h3 className="text-sm font-semibold text-gray-900">Chat conversation area</h3>
        <p className="mt-1 text-xs text-gray-500">The surface behind message bubbles. Independent from the Messages page background.</p>
        <div className="mt-2">
          {renderBackgroundControl("conversation", "Conversation area")}
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}