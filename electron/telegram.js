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

module.exports = { sendMessage, fetchUpdates, whoAmI };
