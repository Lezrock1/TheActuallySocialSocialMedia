export const MAX_CAMERA_VIDEO_MS = 30_000;
export const MIN_CAMERA_VIDEO_MS = 600;

// Prefer MP4 (plays on every iPhone); fall back to WebM where MP4 recording is unavailable.
const VIDEO_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function isVideoRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function pickVideoMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return VIDEO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function videoFileExtension(mimeType: string): string {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

// A still frame used as the story bubble / preview image for a video.
export async function captureVideoPoster(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Could not read this video")), 8000);
      video.onloadeddata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not read this video"));
      };
      video.load();
    });
    const target = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(0.2, video.duration / 2) : 0;
    if (target > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = target;
        window.setTimeout(resolve, 1500);
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare a preview image");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("Could not prepare a preview image");
    return new File([blob], "video-poster.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
