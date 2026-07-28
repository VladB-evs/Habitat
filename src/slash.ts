import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { api } from './api';
import SlashList, { SlashListHandle } from './components/SlashList';
import { evalCode } from './script';
import { openStatusOf, taskProp } from './util';
import { placePopup } from './suggestionPopup';
import { todayKey } from './util';

export interface SlashItem {
  id: string;
  label: string;
  icon: string;
  hint: string;
  group: string;
  run: (editor: any, range: any) => void | Promise<void>;
}

const fmtTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const insertText = (editor: any, range: any, text: string) =>
  editor.chain().focus().insertContentAt(range, text).run();

function blockItems(): SlashItem[] {
  const block = (id: string, label: string, icon: string, hint: string, apply: (c: any) => any): SlashItem => ({
    id,
    label,
    icon,
    hint,
    group: 'Blocks',
    run: (editor, range) => apply(editor.chain().focus().deleteRange(range)).run(),
  });
  return [
    block('h1', 'Heading 1', 'h1', 'Big heading', (c) => c.setNode('heading', { level: 1 })),
    block('h2', 'Heading 2', 'h2', 'Medium heading', (c) => c.setNode('heading', { level: 2 })),
    block('h3', 'Heading 3', 'h3', 'Small heading', (c) => c.setNode('heading', { level: 3 })),
    block('todo', 'To-do list', 'list-todo', 'Checkboxes', (c) => c.toggleTaskList()),
    block('bullet', 'Bullet list', 'list', 'Plain list', (c) => c.toggleBulletList()),
    block('numbered', 'Numbered list', 'list-ordered', '1. 2. 3.', (c) => c.toggleOrderedList()),
    block('quote', 'Quote', 'quote', 'Callout text', (c) => c.toggleBlockquote()),
    block('code', 'Code block', 'code', 'Syntax highlighted', (c) => c.toggleCodeBlock()),
    block('table', 'Table', 'table', '3×3 with a header row', (c) =>
      c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    ),
    block('divider', 'Divider', 'minus', 'Horizontal rule', (c) => c.setHorizontalRule()),
    block('text', 'Plain text', 'doc', 'Paragraph', (c) => c.setParagraph()),
  ];
}

const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

const fmtLong = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** ISO-8601 week number. */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - start.getTime()) / 86400000 + 1) / 7);
}

function weekRange(): string {
  const d = new Date();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${mon.toLocaleDateString('en-US', opts)} – ${sun.toLocaleDateString('en-US', opts)}`;
}

/** Every built-in value variable, in menu order. Also powers the Settings reference. */
export const BUILT_IN_VARS: { id: string; label: string; icon: string; group: string; value: () => string }[] = [
  { id: 'date', label: 'Date', icon: 'calendar', group: 'Date & time', value: fmtDate },
  { id: 'time', label: 'Time', icon: 'clock', group: 'Date & time', value: fmtTime },
  { id: 'datetime', label: 'Date & time', icon: 'clock', group: 'Date & time', value: () => `${fmtDate()}, ${fmtTime()}` },
  { id: 'yesterday', label: 'Yesterday', icon: 'calendar', group: 'Date & time', value: () => fmtLong(dayOffset(-1)) },
  { id: 'tomorrow', label: 'Tomorrow', icon: 'calendar', group: 'Date & time', value: () => fmtLong(dayOffset(1)) },
  {
    id: 'weekday',
    label: 'Weekday',
    icon: 'calendar',
    group: 'Date & time',
    value: () => new Date().toLocaleDateString('en-US', { weekday: 'long' }),
  },
  { id: 'week', label: 'Week number', icon: 'hash', group: 'Date & time', value: () => `W${isoWeek(new Date())}` },
  { id: 'weekrange', label: 'This week', icon: 'calendar', group: 'Date & time', value: weekRange },
  {
    id: 'month',
    label: 'Month',
    icon: 'calendar',
    group: 'Date & time',
    value: () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  },
  { id: 'isodate', label: 'ISO date', icon: 'hash', group: 'Identifiers', value: () => todayKey() },
  { id: 'timestamp', label: 'Timestamp', icon: 'clock', group: 'Identifiers', value: () => new Date().toISOString() },
  { id: 'uuid', label: 'UUID', icon: 'hash', group: 'Identifiers', value: () => crypto.randomUUID() },
];

/** Attachments come in through the same store whether picked, pasted or dropped. */
function mediaItems(): SlashItem[] {
  const add = (id: string, label: string, icon: string, hint: string, images: boolean): SlashItem => ({
    id,
    label,
    icon,
    hint,
    group: 'Insert',
    run: async (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      const refs = await api.files.pick({ images });
      if (refs.length) editor.chain().focus().insertMedia(refs).run();
    },
  });
  return [
    add('image', 'Image', 'image', 'Pick from your computer', true),
    add('file', 'File', 'paperclip', 'Attach anything', false),
  ];
}

function insertItems(): SlashItem[] {
  return BUILT_IN_VARS.map((v) => ({
    id: v.id,
    label: v.label,
    icon: v.icon,
    group: v.group,
    hint: v.value(),
    run: (e: any, r: any) => insertText(e, r, v.value()),
  }));
}

/**
 * Makes a real, unscheduled task out of whatever is already on the line and drops
 * a link to it in its place — one deliberate action instead of the old
 * checkbox-watching, which fired at the wrong moments.
 */
async function makeTask(editor: any, range: any) {
  const types = await api.types.list();
  const type = types.find((t) => t.id === 'task' && taskProp(t)) ?? types.find((t) => taskProp(t));
  if (!type) {
    editor.chain().focus().deleteRange(range).run();
    return;
  }
  const prop = taskProp(type)!;

  // Everything typed on this line before the slash becomes the title.
  const $from = editor.state.doc.resolve(range.from);
  const blockStart = $from.start();
  const typed = editor.state.doc.textBetween(blockStart, range.from, '\n', ' ').trim();

  // No due date, so it lands in Unscheduled.
  const made = await api.objects.create({ typeId: type.id, title: typed, props: { [prop.id]: openStatusOf(prop) } });
  if (!made) return;
  editor
    .chain()
    .focus()
    .deleteRange({ from: blockStart, to: range.to })
    .insertContent([
      // With nothing typed yet the chip opens as a title field, caret inside.
      { type: 'mention', attrs: { id: made.id, label: typed || 'Untitled', draft: !typed } },
      { type: 'text', text: ' ' },
    ])
    .run();
}

/** Shortcuts to the other editor pickers, so `/` is a complete index of what the editor can do. */
function triggerItems(): SlashItem[] {
  const trigger = (id: string, label: string, icon: string, hint: string, char: string): SlashItem => ({
    id,
    label,
    icon,
    hint,
    group: 'Insert',
    run: (editor, range) => editor.chain().focus().insertContentAt(range, char).run(),
  });
  return [
    {
      id: 'make-task',
      label: 'Task',
      icon: 'circle-check',
      hint: 'creates an unscheduled task',
      group: 'Insert',
      run: makeTask,
    },
    trigger('mention', 'Link an object', 'link', 'Opens the @ picker', '@'),
    trigger('tag', 'Tag', 'hash', 'Opens the # picker', '#'),
    trigger('emoji', 'Emoji', 'smile', 'Opens the : picker', ':'),
    {
      id: 'math',
      label: 'Equation',
      icon: 'sigma',
      hint: 'Inline maths, like $e^{i\\pi}+1=0$',
      group: 'Insert',
      // Caret between the dollars, ready to type: the render happens as soon as
      // it leaves. `$$` on its own would match the empty-maths regex, so the
      // selection is put in the middle rather than at the end.
      run: (editor, range) =>
        editor
          .chain()
          .focus()
          .insertContentAt(range, '$$')
          .setTextSelection(range.from + 1)
          .run(),
    },
  ];
}

/**
 * How well one item answers what's been typed. The name counts for far more
 * than the group or the preview value, which is what stops every "Date & time"
 * row from matching "/time" equally and leaving Date on top.
 */
function score(item: SlashItem, q: string): number {
  const label = item.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  if (label.includes(q)) return 40;
  // Still worth finding: "/identifier" reaches UUID through its group, "/uuid"
  // through its own name, "/2026" through the value it would insert.
  if (`${item.group} ${item.hint}`.toLowerCase().includes(q)) return 10;
  return 0;
}

/**
 * Matches, best first, but still grouped: items are sorted inside their group
 * and the groups are ordered by their best item. The menu keeps its headings
 * and the row you meant is at the top.
 */
function ranked(items: SlashItem[], q: string): SlashItem[] {
  const hits = items.map((item) => ({ item, s: score(item, q) })).filter((h) => h.s > 0);
  const best = new Map<string, number>();
  const order = new Map<string, number>();
  for (const h of hits) {
    best.set(h.item.group, Math.max(best.get(h.item.group) ?? 0, h.s));
    if (!order.has(h.item.group)) order.set(h.item.group, order.size);
  }
  const group = (g: string) => [best.get(g)!, order.get(g)!] as const;
  return hits
    .sort((a, b) => {
      const [ba, oa] = group(a.item.group);
      const [bb, ob] = group(b.item.group);
      // Groups stay whole — two of them scoring the same must not interleave.
      return bb - ba || oa - ob || b.s - a.s;
    })
    .map((h) => h.item);
}

const suggestionConfig = {
  char: '/',
  pluginKey: new PluginKey('slashCommands'),

  items: async ({ query }: { query: string }): Promise<SlashItem[]> => {
    const vars = await api.vars.list();
    // User scripts only run when chosen, never during listing.
    const custom: SlashItem[] = vars.map((v) => ({
      id: 'var:' + v.id,
      label: v.name || 'Unnamed variable',
      icon: 'zap',
      hint: 'your script',
      group: 'Your variables',
      run: async (editor: any, range: any) => {
        editor.chain().focus().deleteRange(range).run();
        const text = await evalCode(v.code);
        editor.chain().focus().insertContent(text).run();
      },
    }));
    const q = query.trim().toLowerCase();
    const all = [...blockItems(), ...mediaItems(), ...triggerItems(), ...insertItems(), ...custom];
    return q ? ranked(all, q) : all;
  },

  command: ({ editor, range, props }: any) => {
    (props as SlashItem).run(editor, range);
  },

  render: () => {
    let component: ReactRenderer<SlashListHandle> | null = null;
    let popup: HTMLDivElement | null = null;

    const place = (clientRect: (() => DOMRect | null) | null | undefined) => placePopup(popup, clientRect);

    const cleanup = () => {
      popup?.remove();
      component?.destroy();
      popup = null;
      component = null;
    };

    return {
      onStart: (props: any) => {
        component = new ReactRenderer(SlashList, { props, editor: props.editor });
        popup = document.createElement('div');
        popup.className = 'mention-popup';
        popup.appendChild(component.element);
        document.body.appendChild(popup);
        place(props.clientRect);
      },
      onUpdate: (props: any) => {
        component?.updateProps(props);
        place(props.clientRect);
      },
      onKeyDown: (props: any) => {
        if (props.event.key === 'Escape') {
          cleanup();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: cleanup,
    };
  },
};

export const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...suggestionConfig } as any)];
  },
});
