const pendingRequests = new Map<string, Promise<MediaStream>>();
const activeStreams = new Map<string, Set<MediaStream>>();

function stableConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableConstraints);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second)).map(([key, child]) => [key, stableConstraints(child)]));
  return value;
}

function rememberStream(key: string, stream: MediaStream): MediaStream {
  const streams = activeStreams.get(key) ?? new Set<MediaStream>();
  streams.add(stream);
  activeStreams.set(key, streams);
  return stream;
}

export async function requestUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone access are unavailable in this browser.");
  const key = JSON.stringify(stableConstraints({ audio: constraints.audio || false, video: constraints.video || false }));
  for (const [signature, streams] of activeStreams) {
    for (const stream of streams) {
      if (!stream.getTracks().some((track) => track.readyState === "live")) streams.delete(stream);
    }
    if (!streams.size) activeStreams.delete(signature);
  }
  const active = activeStreams.get(key)?.values().next().value;
  if (active) return rememberStream(key, active.clone());
  let pending = pendingRequests.get(key);
  if (!pending) {
    pending = navigator.mediaDevices.getUserMedia(constraints);
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
  return rememberStream(key, (await pending).clone());
}