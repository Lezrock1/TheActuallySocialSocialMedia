import { useEffect, useState } from "react";

export default function DecodedImage({ src, alt, className = "", imageClassName = "object-contain", onReady }: {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  onReady?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ src: string; ready: boolean; failed: boolean } | null>(null);
  const url = attempt ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    void image.decode().then(() => {
      if (!cancelled) setResult({ src: url, ready: true, failed: false });
    }).catch(() => {
      if (!cancelled) setResult({ src: url, ready: false, failed: true });
    });
    return () => { cancelled = true; };
  }, [url]);

  const ready = result?.src === url && result.ready;
  const failed = result?.src === url && result.failed;
  return (
    <span className={`relative block overflow-hidden ${className}`} aria-busy={!ready && !failed}>
      {ready ? <img key={url} src={url} alt={alt} draggable={false} onLoad={onReady} className={`h-full w-full motion-safe:animate-[page-header-enter_160ms_ease-out] ${imageClassName}`} /> : (
        <span className="absolute inset-0 flex items-center justify-center bg-black/10">
          {failed ? <button type="button" aria-label={`Retry ${alt}`} onClick={(event) => { event.stopPropagation(); setAttempt((value) => value + 1); }} className="relative z-20 rounded bg-black/60 px-2 py-1 text-xs text-white">Retry</button>
            : <span role="status" aria-label={`Loading ${alt}`} className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />}
        </span>
      )}
    </span>
  );
}