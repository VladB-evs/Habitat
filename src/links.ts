/**
 * One place for what counts as a link, how it opens, and how bare URLs already
 * sitting in old notes become clickable.
 */

/** The only schemes a stored note is allowed to launch. */
const SAFE = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Bare URLs inside body text: `www.` and a scheme, stopping before trailing
 * punctuation so "see https://x.com." doesn't swallow the full stop, and
 * balancing a closing bracket so wiki-style URLs survive.
 */
export const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]|\b[^\s<>"'`@]+@[^\s<>"'`@]+\.[a-z]{2,}\b/gi;

/** A bare `www.x.com` or `a@b.com` isn't a URL until it has a scheme. */
export function withScheme(raw: string): string {
  const s = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return 'mailto:' + s;
  return 'https://' + s;
}

/**
 * Whether a href may be followed. Anything that isn't plainly a web, mail or phone
 * link is refused — `javascript:` and `file:` in particular, since note content can
 * arrive from an import or a shared vault and is not to be trusted with more than
 * opening a page.
 */
export function isSafeUrl(href: string): boolean {
  try {
    return SAFE.includes(new URL(withScheme(href)).protocol);
  } catch {
    return false;
  }
}

/**
 * Hand a link to the OS browser. `window.open` is what the main process already
 * intercepts (`setWindowOpenHandler` → `shell.openExternal`), so nothing here ever
 * navigates the app's own window out of the renderer.
 */
export function openLink(href: string): void {
  if (!isSafeUrl(href)) return;
  window.open(withScheme(href), '_blank', 'noreferrer');
}

type Node = { type?: string; text?: string; marks?: any[]; content?: Node[]; [k: string]: any };

/**
 * Give bare URLs in a stored doc their link mark, on the way into the editor.
 *
 * Notes written before links existed hold them as plain text, and autolink only
 * ever fires on what's being typed now. Doing it here — to the content handed to
 * the editor, not to what's in the vault — means old notes are clickable straight
 * away without a migration that would restamp every note's "edited" time. The mark
 * gets written back the next time the note is genuinely edited.
 */
export function linkify<T>(doc: T): T {
  if (!doc || typeof doc !== 'object') return doc;

  const walk = (node: Node): Node | Node[] => {
    // Code is quoted on purpose — a URL in a snippet is text, not a destination.
    if (node.type === 'codeBlock') return node;
    if (node.content) return { ...node, content: node.content.flatMap(walk) };
    if (node.type !== 'text' || !node.text) return node;
    if (node.marks?.some((m) => m.type === 'link' || m.type === 'code')) return node;

    const text = node.text;
    URL_RE.lastIndex = 0;
    const pieces: Node[] = [];
    let at = 0;
    for (const m of text.matchAll(URL_RE)) {
      const start = m.index!;
      if (!isSafeUrl(m[0])) continue;
      if (start > at) pieces.push({ ...node, text: text.slice(at, start) });
      pieces.push({
        ...node,
        text: m[0],
        marks: [...(node.marks ?? []), { type: 'link', attrs: { href: withScheme(m[0]) } }],
      });
      at = start + m[0].length;
    }
    if (!pieces.length) return node;
    if (at < text.length) pieces.push({ ...node, text: text.slice(at) });
    return pieces;
  };

  return walk(doc as Node) as T;
}
