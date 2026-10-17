/** True inside the Android app (mobile/shim.ts sets the flag before any app code runs). */
export const IS_MOBILE = typeof window !== 'undefined' && !!(window as unknown as { __TUNES_MOBILE?: boolean }).__TUNES_MOBILE;
