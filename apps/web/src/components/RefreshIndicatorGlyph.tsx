import type { RefreshBird } from "../lib/refreshAppearance.js";

export default function RefreshIndicatorGlyph({
  bird,
  color,
  animated = false,
  size = 36,
}: {
  bird: RefreshBird;
  color: string;
  animated?: boolean;
  size?: number;
}) {
  if (bird === "classic") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        width={size}
        height={size}
        className={animated ? "refresh-arrows-rotation" : undefined}
        style={{ color }}
      >
        <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M25 12.5a9.5 9.5 0 0 0-16-5L6 10.5" />
          <path d="M5.5 5.2v5.5H11" />
          <path d="M7 19.5a9.5 9.5 0 0 0 16 5l3-3" />
          <path d="M26.5 26.8v-5.5H21" />
        </g>
      </svg>
    );
  }

  const wingClassName = animated ? "refresh-bird-wing refresh-bird-wing-fast" : "refresh-bird-wing";

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 180 120"
      width={size}
      height={size * 2 / 3}
      style={{ color }}
    >
      {bird === "swallow" && (
        <g>
          <path d="m63 68-43-23 23 25-18 25 43-15Z" fill="currentColor" />
          <path d="M59 72c20-22 43-33 67-28 11 2 17 8 19 16l17 8-18 6c-8 12-22 17-40 14L67 82Z" fill="currentColor" />
          <path className={wingClassName} d="M111 62C97 39 77 19 53 11c11 25 24 44 45 58Z" fill="currentColor" opacity=".55" />
          <path d="m145 57 14 4-13 4Z" fill="#f2bd52" />
          <circle cx="137" cy="54" r="1.7" fill="white" />
          <circle cx="137.5" cy="54" r=".8" fill="#20343a" />
        </g>
      )}
      {bird === "swift" && (
        <g fill="currentColor">
          <path d="M73 68C55 47 37 31 12 23c10 23 22 40 42 54-17-7-31-9-47-6 20 17 39 23 67 21l26-18Z" />
          <path className={wingClassName} d="M88 64c19-20 39-35 67-42-9 24-23 43-46 57 16-6 31-7 48-3-19 18-40 25-70 22l-24-17Z" opacity=".58" />
          <path d="M53 68c17-8 37-11 60-7 13 3 21 8 25 14-9 9-22 13-38 12-22-1-37-7-47-19Z" />
          <path d="m72 85-12 17 22-13m16 0 17 13-6-17" />
          <path d="m132 68 14 4-14 4Z" fill="#f2bd52" />
          <circle cx="128" cy="65" r="1.4" fill="white" />
        </g>
      )}
      {bird === "hummingbird" && (
        <g>
          <path d="m111 57 58-11-57 17Z" fill="#384238" />
          <path d="M87 52c11-12 24-13 34-4 7 7 8 18 2 29-8 13-23 16-37 7-10-7-10-22 1-32Z" fill="currentColor" />
          <path d="M95 72c12-6 23-5 34 2-9 8-20 12-31 10Z" fill="#d45d52" />
          <path className={wingClassName} d="M99 48C82 28 68 17 49 9c6 19 15 34 32 47Z" fill="currentColor" opacity=".62" />
          <path d="M99 53c-18 6-33 17-45 33 21-1 39-7 54-20Z" fill="currentColor" opacity=".82" />
          <path d="m87 82-13 16 24-9Z" fill="currentColor" />
          <circle cx="117" cy="54" r="1.7" fill="#20372f" />
        </g>
      )}
      {bird === "kingfisher" && (
        <g>
          <path d="M29 70c17-22 39-34 67-32 19 1 32 11 35 26-4 18-18 28-39 28-23 0-44-8-63-22Z" fill="currentColor" />
          <path d="M57 69c13-12 28-19 46-19 13 0 22 5 27 14-6 18-18 26-35 27-16-5-29-12-38-22Z" fill="#e28a46" />
          <path className={wingClassName} d="M50 54c20-12 42-17 63-14-17 7-29 15-38 26Z" fill="currentColor" opacity=".55" />
          <path d="M91 43c7-21 25-29 40-20 9 5 12 16 8 28l-18 13-27-5Z" fill="currentColor" />
          <path d="m135 41 39 4-40 7Z" fill="#263a3f" />
          <circle cx="126" cy="34" r="2" fill="white" />
          <circle cx="126" cy="34" r=".9" fill="#263a3f" />
        </g>
      )}
      {bird === "robin" && (
        <g>
          <path d="m45 78-22 12 14-21-9-15 24 8Z" fill="currentColor" />
          <path d="M39 68c11-20 31-31 53-28 18 2 29 13 30 28-2 17-17 28-38 28-18 0-34-9-45-28Z" fill="currentColor" />
          <path d="M78 53c17-11 34-8 43 4 7 10 5 22-3 31-13 5-27 4-41-3-8-10-8-22 1-32Z" fill="#d66d4e" />
          <path className={wingClassName} d="M52 69c13-17 31-26 52-28-10 15-22 24-39 31Z" fill="currentColor" opacity=".55" />
          <path d="M86 46c8-16 24-21 36-11 6 6 7 15 3 24l-13 8-26-8Z" fill="currentColor" />
          <path d="m121 49 17 4-17 4Z" fill="#c4934f" />
          <circle cx="116" cy="43" r="1.7" fill="white" />
        </g>
      )}
      {bird === "crane" && (
        <g>
          <path d="M28 75c19-15 42-21 68-17 19 3 31 12 35 23-13 13-32 18-53 15-20-2-37-9-50-21Z" fill="currentColor" />
          <path className={wingClassName} d="M60 69c22-14 43-17 62-7-12 11-27 17-46 17Z" fill="currentColor" opacity=".52" />
          <path d="M117 78c2-13-3-22-15-29-7-4-10-10-8-16 2-5 7-8 14-8 11 0 16 8 13 17l-7 9c12 7 18 18 16 31Z" fill="currentColor" />
          <path d="M107 26c6-11 17-15 26-9 5 4 6 10 3 16l-12 8-13-5Z" fill="currentColor" />
          <path d="m135 31 27 2-27 4Z" fill="#384348" />
          <path d="M115 20c4-8 11-10 18-8l-1 7Z" fill="#c44d49" />
          <circle cx="128" cy="26" r="1.5" fill="white" />
        </g>
      )}
      {bird === "falcon" && (
        <g>
          <path d="m72 63-51-34 29 42L19 93l58-13Z" fill="currentColor" />
          <path className={wingClassName} d="m90 62 37-40-17 46 37 18-54 2Z" fill="currentColor" opacity=".62" />
          <path d="M52 73c19-15 42-21 65-15 14 4 21 12 22 22-12 12-31 16-52 12-14-3-26-9-35-19Z" fill="currentColor" />
          <path d="M112 60c8-17 22-22 34-14 7 5 8 14 4 23l-15 11-25-6Z" fill="currentColor" />
          <path d="m145 66 23 3-23 5Z" fill="#e0b35c" />
          <path d="m131 61 19 5-16 4Z" fill="#29383b" />
          <circle cx="141" cy="61" r="1.5" fill="#f3d9a1" />
        </g>
      )}
      {bird === "woodpecker" && (
        <g>
          <path d="m65 68-37-14 23 21-15 20 35-12Z" fill="currentColor" />
          <path d="M53 69c12-18 30-27 49-24 15 3 23 13 22 27-2 16-16 25-34 24-16-1-28-10-37-27Z" fill="currentColor" />
          <path className={wingClassName} d="M68 57c13-9 24-10 38-5l-8 8c-13-3-22 0-30 7Z" fill="#fff" opacity=".55" />
          <path d="M87 46c8-17 22-21 34-12 7 6 7 16 1 25l-16 8-23-8Z" fill="currentColor" />
          <path d="M94 41c3-12 15-16 25-11l4 9-14-2-8 9Z" fill="#cf4d43" />
          <path d="m119 55 42 4-42 4Z" fill="#b87545" />
          <circle cx="116" cy="48" r="1.5" fill="white" />
        </g>
      )}
      {bird === "puffin" && (
        <g>
          <path d="m52 71-28 12 18-22-4-15 24 12Z" fill="currentColor" />
          <path d="M42 65c12-21 33-31 54-27 20 3 31 17 28 34-3 18-19 28-41 27-18-1-33-12-41-34Z" fill="currentColor" />
          <path d="M72 52c18-12 39-8 48 7 6 11 3 24-7 32-16 7-32 3-44-8-7-10-6-22 3-31Z" fill="#f5f3ed" />
          <path className={wingClassName} d="M51 67c14-15 30-20 47-18-11 11-22 18-37 24Z" fill="currentColor" opacity=".58" />
          <path d="M88 44c8-16 23-20 36-11 8 6 9 17 3 27l-17 9-25-10Z" fill="currentColor" />
          <path d="M122 47c15-7 31-2 36 11-2 10-10 17-22 18l-17-10Z" fill="#ee8749" />
          <path d="M119 47c9-7 20-7 28-2l-4 7-19 4Z" fill="#f3c856" />
          <circle cx="117" cy="43" r="1.7" fill="#f3eee1" />
        </g>
      )}
      {bird === "toucan" && (
        <g>
          <path d="m63 73-36 18 22-29-8-17 32 11Z" fill="currentColor" />
          <path d="M52 69c12-20 31-29 52-24 17 4 25 16 22 31-4 17-18 25-38 23-18-2-29-12-36-30Z" fill="currentColor" />
          <path d="M69 56c15-11 32-8 42 5 5 7 6 15 2 22-14 6-28 4-40-5-8-7-9-15-4-22Z" fill="#e3bd4d" />
          <path className={wingClassName} d="M57 66c14-16 29-23 47-24-11 13-23 21-39 27Z" fill="currentColor" opacity=".56" />
          <path d="M89 48c7-18 21-23 34-14 8 6 9 16 4 27l-16 9-26-11Z" fill="currentColor" />
          <path d="M123 39c19-14 43-13 49-2-4 13-17 28-38 33l-20-8Z" fill="#e6b849" />
          <path d="M145 35c10-4 20-3 27 2-9 2-16 6-23 11Z" fill="#db6349" />
          <circle cx="119" cy="42" r="1.6" fill="#f4f0e2" />
        </g>
      )}
    </svg>
  );
}