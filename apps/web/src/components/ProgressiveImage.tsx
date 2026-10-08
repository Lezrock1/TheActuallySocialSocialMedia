import { useEffect, useRef, useState } from "react";
import { mediaPreviewUrl, mediaUrl } from "../lib/upload.js";

// Blur-up loading: a tiny preview sets the layout and the sharp image fades in over it.
export default function ProgressiveImage({ mediaKey, className = "" }: { mediaKey: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const fullRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLoaded(false);
    setPreviewFailed(false);
    if (fullRef.current?.complete && fullRef.current.naturalWidth > 0) setLoaded(true);
  }, [mediaKey]);

  if (previewFailed) {
    return <img src={mediaUrl(mediaKey)} alt="" loading="lazy" decoding="async" className={`${className} w-full object-cover`} />;
  }

  return (
    <div className={`relative overflow-hidden bg-gray-100 ${className}`}>
      <img
        src={mediaPreviewUrl(mediaKey)}
        alt=""
        aria-hidden="true"
        decoding="async"
        onError={() => setPreviewFailed(true)}
        className={`block max-h-96 w-full scale-110 object-cover blur-xl transition-opacity duration-500 ${loaded ? "opacity-0" : "opacity-100"}`}
      />
      <img
        ref={fullRef}
        src={mediaUrl(mediaKey)}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
