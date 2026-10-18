// Plain-language messages for playback failures. The technical reasons stay
// available under "Details" (and in Stats for nerds), never as the headline.
export function friendlyPlayError(reasons: string[], online = typeof navigator === 'undefined' ? true : navigator.onLine): string {
  const all = reasons.join(' ').toLowerCase();
  if (!online) return 'You’re offline. Connect to the internet and try again.';
  if (/took too long|timed out/.test(all) && !/no match/.test(all)) return 'The music services are slow right now. Try again in a moment.';
  if (/http 429|busy/.test(all)) return 'Too many requests right now. Try again in a minute.';
  if (/unplayable|login_required|age|private|not available/.test(all)) return 'This song isn’t available to play here. Try another version.';
  if (/couldn’t reach|couldn't reach|failed to fetch|network/.test(all)) return 'Couldn’t reach the music services. Check your connection and try again.';
  return 'Couldn’t play this song. Try again, or pick another version.';
}
export function friendlyMediaError(message: string): string {
  if (/4|not supported|src/i.test(message)) return 'This stream format didn’t play. Trying another source…';
  return 'The stream stopped. Trying again…';
}
