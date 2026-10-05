import { lazy, Suspense } from "react";

const ReactMarkdown = lazy(() => import("react-markdown"));

export default function AiMarkdown({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  return (
    <Suspense fallback={<div className={`${className} whitespace-pre-wrap`}>{content}</div>}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
          h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-1 leading-5 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-gray-300 pl-3 text-gray-600">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </Suspense>
  );
}