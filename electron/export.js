// TipTap/ProseMirror JSON → Markdown, and a whole vault → a folder of files.
//
// The mirror of markdown.js's mdToDoc, and deliberately compatible with it:
// mentions come out as [[wikilinks]] and tags as #tags, so a folder exported
// here imports back through Settings › Import without losing its links.

const fs = require('fs');
const path = require('path');

/** Innermost first, so a bold-italic run reads `***x***` rather than `*​**x**​*`. */
const MARK_WRAP = [
  ['code', '`', '`'],
  ['highlight', '==', '=='],
  ['underline', '<u>', '</u>'],
  ['strike', '~~', '~~'],
  ['italic', '*', '*'],
  ['bold', '**', '**'],
];

const isImage = (mime) => String(mime || '').startsWith('image/');

const textOf = (node) =>
  (node.content || []).map((c) => (typeof c.text === 'string' ? c.text : textOf(c))).join('');

function mediaMd(node, ctx) {
  const a = node.attrs || {};
  const href = ctx.fileHref(a);
  const label = a.name || 'attachment';
  const body = `${isImage(a.mime) ? '!' : ''}[${label}](${href})`;
  return a.caption ? `${body}\n\n*${a.caption}*` : body;
}

function inlineNode(node, ctx) {
  if (!node) return '';
  if (typeof node.text === 'string') {
    let text = node.text;
    const marks = new Set((node.marks || []).map((m) => m.type));
    // textStyle (colour) has no Markdown of its own — the text survives, the colour doesn't.
    for (const [name, open, close] of MARK_WRAP) if (marks.has(name)) text = open + text + close;
    return text;
  }
  if (node.type === 'hardBreak') return '  \n';
  if (node.type === 'mention') return `[[${node.attrs?.label || ''}]]`;
  if (node.type === 'tagMention') return `#${node.attrs?.label || ''}`;
  if (node.type === 'media') return mediaMd(node, ctx);
  return inline(node.content, ctx);
}

const inline = (nodes, ctx) => (nodes || []).map((n) => inlineNode(n, ctx)).join('');

function listMd(node, ctx, marker) {
  return (node.content || [])
    .map((item, i) => {
      const lead = marker(i, item);
      // Nested blocks line up under the marker rather than restarting at the margin.
      const pad = ' '.repeat(lead.length);
      const body = blocks(item.content, ctx).split('\n');
      return body.map((line, k) => (k === 0 ? lead : pad) + line).join('\n');
    })
    .join('\n');
}

function tableMd(node, ctx) {
  const rows = (node.content || []).map((row) =>
    (row.content || []).map((cell) => blocks(cell.content, ctx).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim())
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function block(node, ctx) {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content, ctx);
    case 'heading':
      return '#'.repeat(Math.min(node.attrs?.level || 1, 6)) + ' ' + inline(node.content, ctx);
    case 'blockquote':
      return blocks(node.content, ctx)
        .split('\n')
        .map((l) => '> ' + l)
        .join('\n');
    case 'codeBlock':
      return '```' + (node.attrs?.language || '') + '\n' + textOf(node) + '\n```';
    case 'horizontalRule':
      return '---';
    case 'bulletList':
      return listMd(node, ctx, () => '- ');
    case 'orderedList':
      return listMd(node, ctx, (i) => `${i + 1}. `);
    case 'taskList':
      return listMd(node, ctx, (_i, item) => `- [${item.attrs?.checked ? 'x' : ' '}] `);
    case 'table':
      return tableMd(node, ctx);
    case 'media':
      return mediaMd(node, ctx);
    default:
      return Array.isArray(node.content) ? blocks(node.content, ctx) : '';
  }
}

const blocks = (nodes, ctx) =>
  (nodes || [])
    // Only the very end of a block: a hard break is two trailing spaces before a
    // newline, and trimming per line would silently drop it.
    .map((n) => block(n, ctx).replace(/[ \t]+$/, ''))
    .filter((s) => s !== '')
    .join('\n\n');

/** A TipTap doc → Markdown. `fileHref(attrs)` says where an attachment landed. */
function docToMd(doc, ctx = {}) {
  const use = { fileHref: (a) => `files/${String(a.hash || '').slice(0, 2)}/${a.hash}${a.ext || ''}`, ...ctx };
  if (!doc) return '';
  const parsed = typeof doc === 'string' ? safeParse(doc) : doc;
  return parsed ? blocks(parsed.content, use).trim() : '';
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- front matter ----------

const PLAIN = /^[\w][\w .,'/@+-]*$/;

function yamlScalar(v) {
  if (v === null || v === undefined) return "''";
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return s !== '' && s.trim() === s && PLAIN.test(s) ? s : JSON.stringify(s);
}

const yamlValue = (v) => (Array.isArray(v) ? `[${v.map(yamlScalar).join(', ')}]` : yamlScalar(v));

const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/**
 * User properties go under their own `properties:` key rather than at the top
 * level, so a property called "type" or "title" can't collide with the fields
 * Habitat writes itself.
 */
function frontMatter(obj, type, defs, ctx) {
  const head = [
    `title: ${yamlScalar(obj.title || 'Untitled')}`,
    `type: ${yamlScalar(type ? type.name : obj.typeId)}`,
    `id: ${yamlScalar(obj.id)}`,
    `created: ${yamlScalar(iso(obj.createdAt))}`,
    `updated: ${yamlScalar(iso(obj.updatedAt))}`,
  ];
  if (obj.dateKey) head.push(`date: ${yamlScalar(obj.dateKey)}`);
  if (obj.pinned) head.push('pinned: true');

  const rows = [];
  for (const def of defs) {
    const v = obj.props[def.id];
    if (empty(v)) continue;
    // Relations point at objects — a title reads better than an id, and matches
    // the [[wikilinks]] used in the body.
    if (def.kind === 'relation') {
      const titles = (Array.isArray(v) ? v : [v]).map((id) => ctx.titleOf(id)).filter(Boolean);
      if (titles.length) rows.push(`  ${yamlScalar(def.name)}: ${yamlValue(titles)}`);
      continue;
    }
    if (def.kind === 'file' && v && v.hash) {
      rows.push(`  ${yamlScalar(def.name)}: ${yamlScalar(ctx.fileHref(v))}`);
      continue;
    }
    rows.push(`  ${yamlScalar(def.name)}: ${yamlValue(v)}`);
  }
  if (rows.length) head.push('properties:', ...rows);

  return `---\n${head.join('\n')}\n---\n`;
}

// ---------- writing the tree ----------

/** Filesystem-safe but still readable; never empty, never absurdly long. */
function safeFile(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\0]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  return (cleaned || 'Untitled').slice(0, 120);
}

function uniquePath(dir, base, ext, taken) {
  let name = base + ext;
  for (let n = 2; taken.has(path.join(dir, name).toLowerCase()); n++) name = `${base} ${n}${ext}`;
  taken.add(path.join(dir, name).toLowerCase());
  return path.join(dir, name);
}

/**
 * Writes one Markdown file per object, foldered by type, with the attachment
 * store copied alongside so the relative links in the notes resolve.
 */
function writeMarkdown(root, data, filesDir) {
  const typeById = new Map(data.types.map((t) => [t.id, t]));
  const titleById = new Map(data.objects.map((o) => [o.id, o.title || 'Untitled']));
  const ctx = {
    titleOf: (id) => titleById.get(id) || null,
    fileHref: (a) => `../files/${String(a.hash || '').slice(0, 2)}/${a.hash}${a.ext || ''}`,
  };

  const taken = new Set();
  let written = 0;
  const byType = new Map();

  for (const obj of data.objects) {
    const type = typeById.get(obj.typeId);
    const folder = path.join(root, safeFile(type ? type.name : obj.typeId));
    fs.mkdirSync(folder, { recursive: true });

    // A daily note's date is a better filename than its title.
    const base = safeFile(obj.dateKey || obj.title || 'Untitled');
    const defs = [...(type ? type.properties : []), ...(obj.extraProps || [])];
    const body = docToMd(obj.content, ctx);
    const text = frontMatter(obj, type, defs, ctx) + (body ? '\n' + body + '\n' : '\n');

    fs.writeFileSync(uniquePath(folder, base, '.md', taken), text, 'utf8');
    written++;
    byType.set(obj.typeId, (byType.get(obj.typeId) || 0) + 1);
  }

  let files = 0;
  if (filesDir && fs.existsSync(filesDir)) {
    fs.cpSync(filesDir, path.join(root, 'files'), { recursive: true });
    files = data.files.length;
  }

  return { written, files, types: byType.size };
}

module.exports = { docToMd, writeMarkdown, safeFile };
