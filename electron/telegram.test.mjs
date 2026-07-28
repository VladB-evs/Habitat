// The Telegram gate decides whether an incoming message may touch the vault.
// A bot is reachable by anyone who finds it, so these cases are the security
// boundary — run with `npm test`.

import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { gate } = require('./telegram.js');

const NOW = 1_000_000;
const me = { id: 111, username: 'vlad' };
const stranger = { id: 999, username: 'randomer' };

const msg = (o = {}) => ({
  chat: { id: o.chat ?? 111, type: o.type ?? 'private' },
  from: o.from ?? me,
  text: o.text ?? 'hello',
});

test('an unpaired bot cannot be claimed by whoever writes first', () => {
  const fresh = { chatId: '', pairCode: '', pairExpires: 0 };
  assert.equal(gate(fresh, msg({ from: stranger, chat: 999 }), NOW).action, 'ignore');
  // Not even the owner — pairing is deliberate, never implicit.
  assert.equal(gate(fresh, msg(), NOW).action, 'ignore');
});

test('only the live pairing code pairs', () => {
  const pairing = { chatId: '', pairCode: 'K7P2WM', pairExpires: NOW + 60_000 };
  assert.equal(gate(pairing, msg({ from: stranger, chat: 999, text: 'ABC123' }), NOW).action, 'ignore');
  assert.equal(gate(pairing, msg({ text: 'K7P2WM' }), NOW).action, 'pair');
  assert.equal(gate(pairing, msg({ text: ' k7p2wm ' }), NOW).action, 'pair', 'case and padding are forgiven');
  assert.equal(gate(pairing, msg({ text: 'K7P2WM' }), NOW + 120_000).action, 'ignore', 'expired');
  assert.equal(gate(pairing, msg({ text: 'K7P2WM', type: 'supergroup' }), NOW).action, 'ignore', 'groups refused');
  assert.equal(String(gate(pairing, msg({ text: 'K7P2WM' }), NOW).userId), '111', 'sender is captured');
});

test('a paired link accepts only that chat and that sender', () => {
  const live = { chatId: '111', userId: '111', userName: 'vlad' };
  assert.equal(gate(live, msg(), NOW).action, 'ingest');
  assert.equal(gate(live, msg({ chat: 999, from: stranger }), NOW).action, 'ignore', 'other chat');
  assert.equal(gate(live, msg({ from: stranger }), NOW).action, 'ignore', 'other sender in the same chat');
  assert.equal(gate(live, msg({ type: 'group' }), NOW).action, 'ignore', 'group');
  assert.equal(gate(live, msg({ text: '   ' }), NOW).action, 'ignore', 'empty');
});

test('links made before pairing existed keep working, and tighten', () => {
  const legacy = { chatId: '111', userId: '' };
  const verdict = gate(legacy, msg(), NOW);
  assert.equal(verdict.action, 'ingest');
  assert.equal(String(verdict.userId), '111', 'adopts the sender so later messages are checked against it');
  assert.equal(gate(legacy, msg({ chat: 999, from: stranger }), NOW).action, 'ignore');
});
