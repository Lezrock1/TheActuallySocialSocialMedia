import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FactCheckSummary } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import AiMarkdown from "./AiMarkdown.js";

type FactCheckVerdict = "true" | "uncertain" | "false" | "partly_false";

const verdictPresentation: Record<FactCheckVerdict, {
  label: string;
  button: string;
  panel: string;
}> = {
  true: {
    label: "Likely true",
    button: "text-green-700 hover:text-green-800",
    panel: "border-green-100 bg-green-50 text-green-900",
  },
  uncertain: {
    label: "Uncertain",
    button: "text-blue-700 hover:text-blue-800",
    panel: "border-blue-100 bg-blue-50 text-blue-900",
  },
  false: {
    label: "Likely false",
    button: "text-red-700 hover:text-red-800",
    panel: "border-red-100 bg-red-50 text-red-900",
  },
  partly_false: {
    label: "Partly false",
    button: "text-orange-700 hover:text-orange-800",
    panel: "border-orange-100 bg-orange-50 text-orange-950",
  },
};

function parseVerdict(summary: string | null): {
  verdict: FactCheckVerdict;
  content: string | null;
} {
  const match = summary?.match(/^VERDICT:\s*(TRUE|UNCERTAIN|FALSE|PARTLY_FALSE)\s*(?:\r?\n|$)/i);
  if (!match) return { verdict: "uncertain", content: summary };
  return {
    verdict: match[1].toLowerCase() as FactCheckVerdict,
    content: summary!.slice(match[0].length).trim(),
  };
}

async function fetchSummary(postId: string): Promise<FactCheckSummary> {
  return apiFetch<FactCheckSummary>(`/posts/${postId}/factcheck-summary`);
}

export default function FactCheckTransparency({ postId }: { postId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery({
    queryKey: ["factcheck-summary", postId],
    queryFn: () => fetchSummary(postId),
  });

  if (!data || data.count === 0) return null;
  const result = parseVerdict(data.summary);
  const presentation = verdictPresentation[result.verdict];

  return (
    <div className="mt-3 text-xs text-gray-500">
      <button onClick={() => setExpanded((e) => !e)} className={`font-medium hover:underline ${presentation.button}`}>
        {data.bucketLabel} people have fact-checked this post
        {expanded ? " ▲" : " ▼"}
      </button>
      {expanded && result.content && (
        <div className={`mt-2 rounded-lg border p-3 ${presentation.panel}`}>
          <p className="mb-2 text-xs font-semibold">{presentation.label}</p>
          <AiMarkdown content={result.content} />
        </div>
      )}
    </div>
  );
}
