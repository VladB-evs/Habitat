/**
 * Links out to the settings guide on the website.
 *
 * Settings panels stay short on purpose: a line each, and the long explanation
 * lives online. Until that site exists `GUIDE_URL` is empty and every link
 * renders nothing, so there are no dead links in the meantime — filling this in
 * is the only change needed to turn them all on.
 */
export const GUIDE_URL = '';

/** Anchors open in the user's browser via main.js's window-open handler. */
export function GuideLink({ slug, label = 'Guide' }: { slug: string; label?: string }) {
  if (!GUIDE_URL) return null;
  return (
    <a className="set-guide" href={`${GUIDE_URL}/${slug}`} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}
