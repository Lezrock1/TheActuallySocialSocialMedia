import { Link } from "react-router-dom";

// Group 1: a web link. Groups 2-3: an @mention, which must not directly follow a word character.
const TOKEN_PATTERN = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)|(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})(?![A-Za-z0-9_])|(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,64})(?![\p{L}\p{N}_])/gu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function splitTrailingPunctuation(raw: string): [string, string] {
  let url = raw;
  let tail = "";
  const trailing = url.match(TRAILING_PUNCTUATION)?.[0] ?? "";
  if (trailing) {
    url = url.slice(0, url.length - trailing.length);
    tail = trailing;
  }
  // Keep a closing bracket that belongs to the link, e.g. a Wikipedia URL.
  if (tail.startsWith(")") && url.includes("(") && !url.includes(")")) {
    url += ")";
    tail = tail.slice(1);
  }
  return [url, tail];
}

export default function LinkedMentions({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match[1]) {
      const [url, tail] = splitTrailingPunctuation(match[1]);
      const href = url.startsWith("www.") ? `https://${url}` : url;
      parts.push(text.slice(lastIndex, match.index));
      parts.push(
        <a
          key={`link-${match.index}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="break-all text-blue-600 underline decoration-blue-600/40 underline-offset-2 transition-colors hover:decoration-blue-600"
        >
          {url}
        </a>
      );
      if (tail) parts.push(tail);
      lastIndex = match.index + match[0].length;
      continue;
    }

    if (match[5]) {
      const start = match.index + match[4].length;
      parts.push(text.slice(lastIndex, start));
      parts.push(<Link key={`hashtag-${start}`} to={`/tags/${encodeURIComponent(match[5].normalize("NFC").toLowerCase())}`} className="font-medium text-blue-700 hover:underline">#{match[5]}</Link>);
      lastIndex = match.index + match[0].length;
      continue;
    }
    const mentionStart = match.index + match[2].length;
    parts.push(text.slice(lastIndex, mentionStart));
    parts.push(
      <Link
        key={`${mentionStart}-${match[3]}`}
        to={`/u/${encodeURIComponent(match[3].toLowerCase())}`}
        className="font-medium text-blue-700 hover:underline"
      >
        @{match[3]}
      </Link>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) return <>{text}</>;
  parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
