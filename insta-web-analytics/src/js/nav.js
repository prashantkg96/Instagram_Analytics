// nav.js — the seam that lets one tab send the reader to another.
//
// views.js cannot call main.js's tab renderer directly: main.js imports the
// views, so importing back would be a cycle. main.js registers the renderer
// here instead, and the views depend only on this two-function module.

let navigate = null;

/** Called once by main.js with its tab renderer. */
export function setNavigator(fn) {
  navigate = fn;
}

/**
 * Switch to `tab` and bring `anchor` into view.
 *
 * A no-op until a navigator is registered, so a view rendered outside the app
 * shell (tests, the export preview) degrades quietly instead of throwing.
 *
 * @param {string} tab      tab id as registered in main.js
 * @param {string} [anchor] id of an element inside that tab
 */
export function goTo(tab, anchor) {
  navigate?.(tab, anchor);
}
