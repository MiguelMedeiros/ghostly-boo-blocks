/**
 * The default world's ground, FNV-1a of its cells in hex. test/terrain.test.ts checks Node makes it; the browser
 * specs check the page's data-ground in Chromium and WebKit says the same, so every engine builds the same ground.
 */
export const GROUND_HEX = "c1f12dd";
