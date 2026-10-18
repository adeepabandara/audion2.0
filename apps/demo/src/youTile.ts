/**
 * The "You" tile of the simulated call: your own live picture while Ola has the camera, your initial otherwise. It
 * shows the very stream Ola reads, so there is no second camera request, and it never keeps the camera on by itself.
 */
export function showSelf(
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
  opts: { fromFile?: boolean } = {},
): void {
  if (!video) return;
  if (!stream) {
    video.srcObject = null;
    video.hidden = true;
    return;
  }
  video.srcObject = stream;
  video.classList.toggle('is-file', !!opts.fromFile);
  video.hidden = false;
  void video.play().catch(() => {
    /* autoplay of a muted inline video is allowed; ignore a stream that ended meanwhile */
  });
}
