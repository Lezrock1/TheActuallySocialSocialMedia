import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { mediaUrl } from "../lib/upload.js";
import DecodedImage from "./DecodedImage.js";

const DISMISS_DISTANCE = 110;

// Full-screen view of an image; drag it away, or use the close button or Esc to dismiss.
export default function ImageLightbox({ mediaKey, onClose }: { mediaKey: string; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; dy: number } | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function apply(dy: number) {
    const distance = Math.abs(dy);
    if (imageRef.current) imageRef.current.style.transform = `translateY(${dy}px) scale(${1 - Math.min(distance, 400) / 1600})`;
    if (backdropRef.current) backdropRef.current.style.backgroundColor = `rgb(0 0 0 / ${1 - Math.min(1, distance / 380)})`;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (closingRef.current || !event.isPrimary) return;
    dragRef.current = { startY: event.clientY, dy: 0 };
    if (imageRef.current) imageRef.current.style.transition = "none";
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.dy = event.clientY - drag.startY;
    apply(drag.dy);
  }

  function onPointerEnd() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !imageRef.current) return;
    imageRef.current.style.transition = "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.05)";
    if (Math.abs(drag.dy) > DISMISS_DISTANCE) {
      closingRef.current = true;
      const direction = drag.dy > 0 ? 1 : -1;
      imageRef.current.style.transform = `translateY(${direction * window.innerHeight}px) scale(0.8)`;
      if (backdropRef.current) backdropRef.current.style.backgroundColor = "rgb(0 0 0 / 0)";
      window.setTimeout(onClose, 180);
      return;
    }
    apply(0);
  }

  return createPortal(
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      className="lightbox-enter fixed inset-0 z-[75] flex items-center justify-center bg-black transition-[background-color] duration-200"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white backdrop-blur-md hover:bg-white/25"
      >
        ×
      </button>
      <div
        ref={imageRef}
        className="h-full w-full touch-none"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <DecodedImage key={mediaKey} src={mediaUrl(mediaKey)} alt="Photo" className="h-full w-full" />
      </div>
    </div>,
    document.body
  );
}
