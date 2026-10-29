import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXTERNAL_PLATFORMS } from "@app/shared";
import type { ExternalPlatform } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { PLATFORM_CHIP, PLATFORM_META } from "../lib/platforms.js";
import FilterChips from "./FilterChips.js";

const CHIPS = EXTERNAL_PLATFORMS.map((platform) => ({
  value: platform,
  label: PLATFORM_META[platform].label,
  activeClass: PLATFORM_CHIP[platform].active,
  inactiveClass: PLATFORM_CHIP[platform].inactive,
}));

/** Inline version of the "Forum sources" setting: choose which followed social networks show up. */
export default function FeedSourceFilter({ onChanged }: { onChanged?: () => void }) {
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ["feed-source-preferences"],
    queryFn: () => apiFetch<{ hiddenPlatforms: ExternalPlatform[] }>("/external/preferences"),
  });
  const save = useMutation({
    mutationFn: (hiddenPlatforms: ExternalPlatform[]) =>
      apiFetch<{ hiddenPlatforms: ExternalPlatform[] }>("/external/preferences", {
        method: "PATCH", body: JSON.stringify({ hiddenPlatforms }),
      }),
    // Flip the chip immediately and roll back if saving fails.
    onMutate: async (hiddenPlatforms) => {
      await client.cancelQueries({ queryKey: ["feed-source-preferences"] });
      const previous = client.getQueryData<{ hiddenPlatforms: ExternalPlatform[] }>(["feed-source-preferences"]);
      client.setQueryData(["feed-source-preferences"], { hiddenPlatforms });
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) client.setQueryData(["feed-source-preferences"], context.previous);
    },
    onSuccess: async (value) => {
      client.setQueryData(["feed-source-preferences"], value);
      onChanged?.();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["feed"] }),
        client.invalidateQueries({ queryKey: ["external-story-items"] }),
      ]);
    },
  });
  if (!preferences.data) return null;
  const hidden = preferences.data.hiddenPlatforms;
  return (
    <FilterChips
      label="Include posts from"
      heading="Include posts from:"
      chips={CHIPS}
      disabled={save.isPending}
      isActive={(value) => !hidden.includes(value)}
      onSelect={(value) => {
        save.mutate(hidden.includes(value) ? hidden.filter((item) => item !== value) : [...hidden, value]);
      }}
    />
  );
}
