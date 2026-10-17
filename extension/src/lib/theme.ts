// Artwork-driven theming: Tunes extracts a palette from album art. Here we
// take an average-of-vivid-pixels colour via canvas (image fetched with the
// extension's host permission so the canvas isn't tainted).
const cache = new Map<string, string>();

export async function artworkColor(url: string): Promise<string> {
  if (!url) return '#2a2a35';
  if (cache.has(url)) return cache.get(url)!;
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 32 });
    const c = new OffscreenCanvas(32, 32);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max === 0 ? 0 : (max - min) / max;
      const w = sat * sat + 0.05; // favour vivid pixels
      if (max < 30 || min > 235) continue;
      r += R * w; g += G * w; b += B * w; n += w;
    }
    if (!n) return '#2a2a35';
    // Darken for a background that keeps white text readable (WCAG AA)
    const k = 0.55;
    const hex = '#' + [r / n, g / n, b / n].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
    cache.set(url, hex);
    return hex;
  } catch {
    return '#2a2a35';
  }
}
