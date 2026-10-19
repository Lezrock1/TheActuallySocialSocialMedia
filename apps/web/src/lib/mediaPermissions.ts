const pendingRequests = new Map<string, Promise<MediaStream>>();

export async function requestUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone access are unavailable in this browser.");
  const key = JSON.stringify(constraints);
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
  return (await pending).clone();
}