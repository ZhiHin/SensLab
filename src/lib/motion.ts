/**
 * The resolved motion preference, on the client (FR-101, `SENS-UX-023`).
 *
 * The `data-motion` attribute on `<html>` carries the account's or the cookie's choice, and
 * the media query carries the operating system's. Reading the attribute *first* is what makes
 * the override work in both directions: a user who asked for full motion here keeps it even
 * with an OS-wide reduce setting, and a user who asked for reduced motion here gets it on a
 * machine that never set one.
 *
 * The stylesheet already resolves this for CSS animation. This is for the handful of places
 * where a component has to know — an animated sequence whose *steps* are timed in JavaScript
 * cannot be flattened by a duration override alone.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const override = document.documentElement.dataset["motion"];
  if (override === "reduced") return true;
  if (override === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
