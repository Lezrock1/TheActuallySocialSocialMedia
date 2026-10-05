import { Link } from "react-router-dom";

const MENTION_PATTERN = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})(?![A-Za-z0-9_])/g;

export default function LinkedMentions({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const mentionStart = match.index + match[1].length;
    parts.push(text.slice(lastIndex, mentionStart));
    parts.push(
      <Link
        key={`${mentionStart}-${match[2]}`}
        to={`/u/${encodeURIComponent(match[2].toLowerCase())}`}
        className="font-medium text-blue-700 hover:underline"
      >
        @{match[2]}
      </Link>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) return <>{text}</>;
  parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}