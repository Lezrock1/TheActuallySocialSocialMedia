import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FactCheckSummary } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import AiMarkdown from "./AiMarkdown.js";

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

  return (
    <div className="mt-3 text-xs text-gray-500">
      <button onClick={() => setExpanded((e) => !e)} className="font-medium text-blue-700 hover:underline">
        {data.bucketLabel} people have fact-checked this post
        {expanded ? " ▲" : " ▼"}
      </button>
      {expanded && data.summary && (
        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-blue-900">
          <AiMarkdown content={data.summary} />
        </div>
      )}
    </div>
  );
}
