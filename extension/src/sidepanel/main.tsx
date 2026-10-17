import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { clearAllCache, dropLegacyCache } from '../lib/cache';
import './styles.css';

/** A render error shows a way out instead of a blank panel. */
class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: String((e as Error)?.message ?? e) }; }
  componentDidCatch(e: unknown) { console.error('[Tunes] UI error', e); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="crash">
        <h2>Something went wrong</h2>
        <p>{this.state.err}</p>
        <button className="pill white" onClick={async () => { await clearAllCache().catch(() => {}); location.reload(); }}>Clear cache and reload</button>
      </div>
    );
  }
}

dropLegacyCache().catch(() => {});
createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);

// Artwork that fails to load (flaky CDN, network blip): retry once, then
// fade to the placeholder instead of showing a broken-image icon.
document.addEventListener('error', (e) => {
  const img = e.target as HTMLImageElement;
  if (!(img instanceof HTMLImageElement)) return;
  if (!img.dataset.retried && img.src) {
    img.dataset.retried = '1';
    const src = img.src;
    setTimeout(() => { img.src = ''; img.src = src; }, 1200);
  } else {
    img.classList.add('broken');
  }
}, true);
document.addEventListener('load', (e) => {
  const img = e.target as HTMLImageElement;
  if (img instanceof HTMLImageElement) img.classList.remove('broken');
}, true);
