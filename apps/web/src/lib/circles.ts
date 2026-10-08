import { useQuery } from "@tanstack/react-query";
import type { CircleSummary, PostVisibility } from "@app/shared";
import { apiFetch } from "./api.js";

export interface Audience {
  visibility: PostVisibility;
  circleId: string | null;
}

export const PUBLIC_AUDIENCE: Audience = { visibility: "public", circleId: null };

export function useCircles() {
  return useQuery({
    queryKey: ["circles"],
    queryFn: async () => {
      const result = await apiFetch<{ circles: CircleSummary[]; maxCircles: number }>("/circles");
      return result;
    },
    staleTime: 60_000,
  });
}

export function audienceToValue(audience: Audience): string {
  return audience.visibility === "circle" && audience.circleId ? `circle:${audience.circleId}` : audience.visibility;
}

export function valueToAudience(value: string): Audience {
  if (value.startsWith("circle:")) return { visibility: "circle", circleId: value.slice("circle:".length) };
  return { visibility: value === "close_friends" ? "close_friends" : "public", circleId: null };
}

// Fields to merge into a post/story request body.
export function audienceBody(audience: Audience): { visibility: PostVisibility; circleId?: string } {
  return audience.visibility === "circle" && audience.circleId
    ? { visibility: "circle", circleId: audience.circleId }
    : { visibility: audience.visibility };
}
