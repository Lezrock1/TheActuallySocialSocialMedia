const pendingRequests = new Map<string, Promise<MediaStream>>();
interface ActiveLease { stream: MediaStream; facing: string | null; device: string | null }
const activeStreams = new Set<ActiveLease>();

function stableConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableConstraints);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second)).map(([key, child]) => [key, stableConstraints(child)]));
  return value;
}

function constraintValue(value: unknown, name: string): string | null {
  if (!value || typeof value !== "object") return null;
  const constraint = (value as Record<string, unknown>)[name];
  if (typeof constraint === "string") return constraint;
  if (!constraint || typeof constraint !== "object") return null;
  const record = constraint as Record<string, unknown>;
  const selected = record.exact ?? record.ideal;
  return typeof selected === "string" ? selected : null;
}

function rememberStream(stream: MediaStream, video: unknown): MediaStream {
  activeStreams.add({ stream, facing: constraintValue(video, "facingMode"), device: constraintValue(video, "deviceId") });
  return stream;
}

export async function requestUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone access are unavailable in this browser.");
  const audio = constraints.audio || false;
  const video = constraints.video || false;
  for (const lease of activeStreams) {
    if (!lease.stream.getTracks().some((track) => track.readyState === "live")) activeStreams.delete(lease);
  }
  const requestedFacing = constraintValue(video, "facingMode");
  const requestedDevice = constraintValue(video, "deviceId");
  const reusableTracks: MediaStreamTrack[] = [];
  for (const lease of activeStreams) {
    if (audio && !reusableTracks.some((track) => track.kind === "audio")) {
      const track = lease.stream.getAudioTracks().find((candidate) => candidate.readyState === "live");
      if (track) reusableTracks.push(track.clone());
    }
    const compatibleVideo = (!requestedFacing || requestedFacing === lease.facing) && (!requestedDevice || requestedDevice === lease.device);
    if (video && compatibleVideo && !reusableTracks.some((track) => track.kind === "video")) {
      const track = lease.stream.getVideoTracks().find((candidate) => candidate.readyState === "live");
      if (track) reusableTracks.push(track.clone());
    }
  }
  const needsAudio = !!audio && !reusableTracks.some((track) => track.kind === "audio");
  const needsVideo = !!video && !reusableTracks.some((track) => track.kind === "video");
  if (!needsAudio && !needsVideo) return rememberStream(new MediaStream(reusableTracks), video);

  const requestConstraints = { audio: needsAudio ? audio : false, video: needsVideo ? video : false };
  const key = JSON.stringify(stableConstraints(requestConstraints));
  let pending = pendingRequests.get(key);
  if (!pending) {
    pending = navigator.mediaDevices.getUserMedia(requestConstraints);
    pendingRequests.set(key, pending);
    void pending.then((stream) => {
      queueMicrotask(() => {
        if (pendingRequests.get(key) === pending) pendingRequests.delete(key);
        stream.getTracks().forEach((track) => track.stop());
      });
    }, () => {
      if (pendingRequests.get(key) === pending) pendingRequests.delete(key);
    });
  }
  try {
    const source = await pending;
    reusableTracks.push(...source.clone().getTracks());
    return rememberStream(new MediaStream(reusableTracks), video);
  } catch (error) {
    reusableTracks.forEach((track) => track.stop());
    throw error;
  }
}
