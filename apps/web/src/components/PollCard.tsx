import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api.js";

interface PollSummary {
  id: string;
  question: string;
  options: { id: string; text: string; voteCount: number }[];
  totalVotes: number;
  myVoteOptionId: string | null;
  isAuthor: boolean;
}

export default function PollCard({ pollId }: { pollId: string }) {
  const queryClient = useQueryClient();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: poll } = useQuery({
    queryKey: ["poll", pollId],
    queryFn: () => apiFetch<{ poll: PollSummary }>(`/polls/${pollId}`).then((result) => result.poll),
  });

  useEffect(() => {
    if (poll?.myVoteOptionId) setSelectedOptionId(poll.myVoteOptionId);
  }, [poll?.myVoteOptionId]);

  async function submitVote() {
    if (!selectedOptionId || !poll) return;
    setVoting(true);
    setError(null);
    const previous = queryClient.getQueryData<PollSummary>(["poll", pollId]);
    if (previous) {
      queryClient.setQueryData<PollSummary>(["poll", pollId], {
        ...previous,
        myVoteOptionId: selectedOptionId,
        options: previous.options.map((option) => {
          const wasMine = option.id === previous.myVoteOptionId;
          const isMine = option.id === selectedOptionId;
          if (!wasMine && !isMine) return option;
          return {
            ...option,
            voteCount: Math.max(0, option.voteCount + (isMine ? 1 : 0) - (wasMine ? 1 : 0)),
          };
        }),
      });
    }
    try {
      const result = await apiFetch<{ poll: PollSummary }>(`/polls/${pollId}/vote`, {
        method: "POST",
        body: JSON.stringify({ optionId: selectedOptionId }),
      });
      queryClient.setQueryData(["poll", pollId], result.poll);
    } catch {
      if (previous) queryClient.setQueryData(["poll", pollId], previous);
      setError("Could not submit your vote. Please try again.");
    } finally {
      setVoting(false);
    }
  }

  if (!poll) return null;
  const hasVoted = poll.myVoteOptionId !== null;
  const showResults = hasVoted || poll.isAuthor;

  return (
    <section aria-label="Poll" className="mt-3 rounded-lg border border-gray-200 p-3">
      <h3 className="text-sm font-semibold text-gray-900">{poll.question}</h3>
      <div className="mt-2 flex flex-col gap-2">
        {poll.options.map((option) => {
          const percent = poll.totalVotes
            ? Math.round((option.voteCount / poll.totalVotes) * 100)
            : 0;
          const isSelected = selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => !hasVoted && setSelectedOptionId(option.id)}
              disabled={hasVoted}
              aria-pressed={isSelected}
              className={`relative min-h-10 overflow-hidden rounded-md border px-3 py-2 text-left text-sm transition-colors duration-200 ${
                isSelected ? "border-[#1D9BF0] bg-[#1D9BF0]/5" : "border-gray-200"
              } ${hasVoted ? "cursor-default" : "hover:border-gray-400"}`}
            >
              {showResults && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-blue-50 transition-[width] duration-500 ease-out"
                  style={{ width: `${percent}%` }}
                />
              )}
              <span className="relative flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{option.text}</span>
                {showResults && <span className="shrink-0 text-xs font-medium text-gray-600">{percent}%</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {showResults ? (
          <p className="text-[11px] text-gray-500">{poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"}</p>
        ) : (
          <p className="text-[11px] text-gray-500">{selectedOptionId ? "You can still change your answer" : "Choose one answer"}</p>
        )}
        {!hasVoted && selectedOptionId && (
          <button
            type="button"
            onClick={() => void submitVote()}
            disabled={voting}
            className="min-h-8 rounded-full bg-[#1D9BF0] px-4 py-1 text-xs font-semibold text-white shadow-sm transition-[background-color,transform] duration-200 hover:bg-[#1688D4] active:scale-95 disabled:opacity-50"
          >
            {voting ? "Voting..." : "Vote"}
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}