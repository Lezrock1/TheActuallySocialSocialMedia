import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXTERNAL_PLATFORMS } from "@app/shared";
import type { ExternalPlatform } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { PLATFORM_META } from "../lib/platforms.js";
import PreferenceSwitch from "./PreferenceSwitch.js";

interface FeedSources { hiddenPlatforms: ExternalPlatform[] }

export default function FeedSourceSettings() {
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ["feed-source-preferences"],
    queryFn: () => apiFetch<FeedSources>("/external/preferences"),
  });
  const save = useMutation({
    mutationFn: (hiddenPlatforms: ExternalPlatform[]) => apiFetch<FeedSources>("/external/preferences", {
      method: "PATCH", body: JSON.stringify({ hiddenPlatforms }),
    }),
    onSuccess: async (value) => {
      client.setQueryData(["feed-source-preferences"], value);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["feed"] }),
        client.invalidateQueries({ queryKey: ["external-story-items"] }),
      ]);
    },
  });
  return (
    <section aria-labelledby="feed-sources-heading" className="mb-4 border-y border-gray-200 py-3">
      <h2 id="feed-sources-heading" className="mb-2 text-sm font-semibold text-gray-900">Forum sources</h2>
      <div className="flex min-h-11 items-center justify-between text-sm text-gray-700">
        <span>InTouch</span><span className="text-xs font-medium text-emerald-700">Always on</span>
      </div>
      {preferences.isPending ? <p role="status" className="py-2 text-xs text-gray-500">Loading preferences...</p>
        : preferences.isError ? <button type="button" onClick={() => void preferences.refetch()} className="py-2 text-xs text-red-600">Could not load preferences. Retry</button>
        : EXTERNAL_PLATFORMS.map((platform) => <PreferenceSwitch key={platform} label={PLATFORM_META[platform].label}
          checked={!preferences.data.hiddenPlatforms.includes(platform)} disabled={save.isPending}
          onChange={(enabled) => save.mutate(enabled ? preferences.data.hiddenPlatforms.filter((value) => value !== platform)
            : [...preferences.data.hiddenPlatforms, platform])} />)}
      {save.isError && <p role="alert" className="mt-2 text-xs text-red-600">Could not save forum sources. Try again.</p>}
    </section>
  );
}