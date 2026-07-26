import { api } from './api';
import { suggestionRenderer } from './suggestionPopup';
import type { MentionEntry, Obj } from './types';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** What distinguishes this object from another with the same name. */
function subtitleFor(o: Obj): string {
  if (o.dateKey) return o.dateKey; // daily notes are easier to scan by ISO date
  const nickname = str(o.props?.nickname);
  return nickname ? `“${nickname}”` : '';
}

function fallbackHint(o: Obj): string {
  return str(o.props?.role) || str(o.props?.email) || new Date(o.createdAt).toLocaleDateString();
}

/**
 * Search matches names and nicknames, so two people can legitimately come back
 * looking identical. Anything ambiguous gets a second distinguishing line
 * (role, email, or created date) so the right one is always pickable.
 */
function disambiguate(objs: Obj[]): MentionEntry[] {
  const withSubs: MentionEntry[] = objs.map((o) => ({ ...o, subtitle: subtitleFor(o) || undefined }));
  const counts = new Map<string, number>();
  const keyOf = (e: MentionEntry) => `${(e.title || '').toLowerCase()}|${e.subtitle ?? ''}`;
  for (const e of withSubs) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
  return withSubs.map((e) =>
    (counts.get(keyOf(e)) ?? 0) > 1
      ? { ...e, subtitle: [e.subtitle, fallbackHint(e)].filter(Boolean).join(' · ') }
      : e
  );
}

export const mentionSuggestion: any = {
  char: '@',
  // Object titles contain spaces — "July 25, 2026", "Project Alpha" — so the
  // query can't stop at the first one.
  allowSpaces: true,

  items: async ({ query }: { query: string }) => {
    const q = query.trim();
    // With spaces allowed the query keeps growing as you write a sentence after
    // an unmatched "@"; give up once it's clearly prose so the menu gets out of the way.
    if (q.length > 40) return [];
    return disambiguate((await api.objects.search(q)).slice(0, 8));
  },

  command: ({ editor, range, props }: any) => {
    const item = props as MentionEntry;
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: 'mention', attrs: { id: item.id, label: item.title || 'Untitled' } },
        { type: 'text', text: ' ' },
      ])
      .run();
  },

  render: suggestionRenderer({}, { hideWhenEmpty: true }),
};
