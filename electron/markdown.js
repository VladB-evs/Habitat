// Minimal Markdown → TipTap/ProseMirror JSON converter, scoped to what
// Obsidian notes actually contain. Not a general-purpose parser.

const INLINE = [
  { re: /^\*\*([^*]+)\*\*/, mark: 'bold' },
  { re: /^__([^_]+)__/, mark: 'bold' },
  { re: /^\*([^*]+)\*/, mark: 'italic' },
  { re: /^_([^_]+)_/, mark: 'italic' },
  { re: /^`([^`]+)`/, mark: 'code' },
];

/**
 * Split a line into text/mark/tag/mention nodes. `onTag(name)` resolves a tag
 * and `onLink(target)` a [[wikilink]] to an object id; returning null leaves
 * either as plain text.
 */
function inlineNodes(line, { onTag, onLink } = {}) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };

  let rest = line;
  while (rest) {
    // #tag — only at a word boundary, so "C#" or a "#" mid-URL is left alone.
    const tag = /^#([A-Za-z0-9][\w/-]*)/.exec(rest);
    if (tag && (!buf || /\s$/.test(buf))) {
      const id = onTag ? onTag(tag[1]) : null;
      if (id) {
        flush();
        out.push({ type: 'tagMention', attrs: { id, label: tag[1] } });
        rest = rest.slice(tag[0].length);
        continue;
      }
    }

    // [[wikilink]] / [[wikilink|alias]] — becomes a real mention when the target
    // was imported too, otherwise falls back to readable text.
    const wiki = /^\[\[([^\]]+)\]\]/.exec(rest);
    if (wiki) {
      const [target, alias] = wiki[1].split('|');
      const hit = onLink ? onLink(target.trim()) : null;
      if (hit) {
        flush();
        out.push({ type: 'mention', attrs: { id: hit.id, label: (alias || hit.label).trim() } });
      } else {
        buf += (alias || target).trim();
      }
      rest = rest.slice(wiki[0].length);
      continue;
    }

    // [label](url) keeps its destination as a link mark. Anything that isn't a web,
    // mail or phone address is flattened to its label — an imported note must not be
    // able to smuggle in a scheme the app would later hand to the OS.
    const link = /^\[([^\]]*)\]\(([^)]+)\)/.exec(rest);
    if (link) {
      const href = link[2].trim();
      const label = link[1] || href;
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        flush();
        out.push({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] });
      } else {
        buf += label;
      }
      rest = rest.slice(link[0].length);
      continue;
    }

    let matched = false;
    for (const { re, mark } of INLINE) {
      const m = re.exec(rest);
      if (m && m[1].trim()) {
        flush();
        out.push({ type: 'text', text: m[1], marks: [{ type: mark }] });
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    buf += rest[0];
    rest = rest.slice(1);
  }
  flush();
  return out;
}

const para = (line, res) => {
  const content = inlineNodes(line, res);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

/** Markdown text → a TipTap doc matching Habitat's editor schema. */
function mdToDoc(text, res = {}) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const content = [];
  let i = 0;

  // Skip YAML frontmatter — Obsidian metadata has no place in the body.
  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const fence = /^```(.*)$/.exec(trimmed);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      i++;
      content.push({
        type: 'codeBlock',
        attrs: { language: fence[1].trim() || null },
        content: body.length ? [{ type: 'text', text: body.join('\n') }] : undefined,
      });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: Math.min(heading[1].length, 3) },
        content: inlineNodes(heading[2], res),
      });
      i++;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) body.push(lines[i++].trim().replace(/^>\s?/, ''));
      content.push({ type: 'blockquote', content: [para(body.join(' '), res)] });
      continue;
    }

    // Task list — checked separately from plain bullets so checkboxes survive.
    if (/^[-*+]\s+\[[ xX]\]\s*/.test(trimmed)) {
      const items = [];
      while (i < lines.length) {
        const m = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push({
          type: 'taskItem',
          attrs: { checked: m[1].toLowerCase() === 'x' },
          content: [para(m[2], res)],
        });
        i++;
      }
      content.push({ type: 'taskList', content: items });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length) {
        const m = /^[-*+]\s+(.*)$/.exec(lines[i].trim());
        if (!m || /^\[[ xX]\]/.test(m[1])) break;
        items.push({ type: 'listItem', content: [para(m[1], res)] });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length) {
        const m = /^\d+[.)]\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push({ type: 'listItem', content: [para(m[1], res)] });
        i++;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    content.push(para(trimmed, res));
    i++;
  }

  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function makeKey(year, month, day) {
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Pull a date out of a daily-note filename. Obsidian lets people name these
 * almost anything, so this covers the common formats: 2024-01-15, 20240115,
 * 15-01-2024, 01-15-2024, "15 January 2024", "January 15, 2024".
 *
 * `anywhere` allows the date to sit mid-name ("Daily note 2024-01-15"). Off by
 * default so a regular note like "Project 2023-06-01 recap" isn't swept up.
 */
function dateKeyFromFilename(name, { anywhere = false } = {}) {
  const base = name.replace(/\.md$/i, '').trim();
  const at = anywhere ? '' : '^';

  // Year first: 2024-01-15 / 2024_01_15 / 2024.01.15 / 2024/01/15 / 20240115
  let m = new RegExp(`${at}(\\d{4})[-_./]?(\\d{2})[-_./]?(\\d{2})`).exec(base);
  if (m) {
    const key = makeKey(Number(m[1]), Number(m[2]), Number(m[3]));
    if (key) return key;
  }

  // Day or month first: 15-01-2024 / 01-15-2024. When one value is > 12 the
  // order is unambiguous; otherwise assume day-first, the more common style.
  m = new RegExp(`${at}(\\d{1,2})[-_./](\\d{1,2})[-_./](\\d{4})`).exec(base);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    const key = a > 12 ? makeKey(year, b, a) : b > 12 ? makeKey(year, a, b) : makeKey(year, b, a);
    if (key) return key;
  }

  // "15 January 2024" / "15 Jan 2024" / "15th March 2023"
  m = new RegExp(`${at}(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+([A-Za-z]{3,})[\\s,-]+(\\d{4})`).exec(base);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) {
      const key = makeKey(Number(m[3]), month, Number(m[1]));
      if (key) return key;
    }
  }

  // "January 15, 2024" / "Jan 15 2024" / "Monday, January 15 2024"
  m = new RegExp(`${at}(?:[A-Za-z]+,?\\s+)?([A-Za-z]{3,})[\\s-]+(\\d{1,2})(?:st|nd|rd|th)?[\\s,-]+(\\d{4})`).exec(base);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month) {
      const key = makeKey(Number(m[3]), month, Number(m[2]));
      if (key) return key;
    }
  }

  return null;
}

module.exports = { mdToDoc, dateKeyFromFilename };
