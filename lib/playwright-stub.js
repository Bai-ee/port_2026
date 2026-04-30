// Stub so Turbopack can resolve the playwright import at build time.
// At runtime the real playwright package is never available on Vercel;
// playwrightFetch.js catches the resulting error gracefully.
export default {};
export const chromium = undefined;
