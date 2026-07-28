// Telegram bridge: capture from your phone, and let automations message you back.
// Config lives in the vault's kv table, so it travels with the habitat.

const API = 'https://api.telegram.org/bot';

async function call(token, method, body) {
  if (!token) throw new Error('no bot token');
  const res = await fetch(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.ok === false) throw new Error(json?.description || `telegram ${method} failed`);
  return json.result;
}

async function sendMessage(cfg, text) {
  if (!cfg?.token || !cfg?.chatId || !text) return null;
  return call(cfg.token, 'sendMessage', { chat_id: cfg.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

/** Long-poll-free: a plain getUpdates from the stored offset, called on a timer. */
async function fetchUpdates(cfg, offset) {
  if (!cfg?.token) return [];
  return call(cfg.token, 'getUpdates', {
    offset: offset ? offset + 1 : undefined,
    timeout: 0,
    allowed_updates: ['message'],
  });
}

async function whoAmI(token) {
  return call(token, 'getMe', {});
}

/**
 * What a single incoming message is allowed to do.
 *
 * A bot is reachable by anyone who finds it, so this is the only thing standing
 * between a stranger and the vault. Kept pure, and out of the poll loop, so the
 * rules can be read in one place:
 *
 *  - private chats only — never a group, channel or supergroup
 *  - while unpaired, nothing counts except the live pairing code
 *  - once paired, both the chat *and* the sender have to match
 *  - anything else is ignored without a reply, which is what stops the bot
 *    confirming to a stranger that it's listening
 */
function gate(cfg, msg, nowMs = Date.now()) {
  const text = (msg?.text || msg?.caption || '').trim();
  if (!text) return { action: 'ignore', reason: 'empty' };
  if (msg.chat?.type !== 'private') return { action: 'ignore', reason: 'not a private chat' };

  const chat = String(msg.chat?.id ?? '');
  const from = String(msg.from?.id ?? '');
  if (!chat || !from) return { action: 'ignore', reason: 'no sender' };

  if (!cfg?.chatId) {
    const live = cfg?.pairCode && (!cfg.pairExpires || nowMs < cfg.pairExpires);
    if (!live) return { action: 'ignore', reason: 'not paired' };
    if (text.toUpperCase() !== String(cfg.pairCode).toUpperCase())
      return { action: 'ignore', reason: 'wrong code' };
    return {
      action: 'pair',
      chatId: chat,
      userId: from,
      userName: msg.from?.username || msg.from?.first_name || '',
    };
  }

  if (chat !== String(cfg.chatId)) return { action: 'ignore', reason: 'other chat' };
  // Links made before pairing existed know the chat but not the sender. In a
  // private chat that's necessarily the same person, so adopt it and tighten.
  if (cfg.userId && from !== String(cfg.userId)) return { action: 'ignore', reason: 'other sender' };
  return { action: 'ingest', text, userId: String(cfg.userId || from) };
}

module.exports = { sendMessage, fetchUpdates, whoAmI, gate };
