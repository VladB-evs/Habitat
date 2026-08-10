const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'types:list', 'types:create', 'types:update', 'types:delete',
  'objects:list', 'objects:get', 'objects:create', 'objects:update', 'objects:setType', 'objects:delete', 'objects:search',
  'objects:createFromTemplate', 'objects:bulkDelete', 'objects:bulkSetProp',
  'templates:list', 'templates:get', 'templates:create', 'templates:update', 'templates:delete',
  'tasks:forDay', 'tasks:setDone', 'agenda:range', 'calendar:range', 'calendar:reschedule', 'calendar:create', 'calendar:skip',
  'daily:get', 'daily:create', 'daily:list',
  'backlinks:list', 'stats:get',
  'canvas:list', 'canvas:create', 'canvas:get', 'canvas:patch', 'canvas:delete',
  'canvas:addItems', 'canvas:moveItems', 'canvas:patchItem', 'canvas:removeItems', 'canvas:order',
  'canvas:addEdge', 'canvas:patchEdge', 'canvas:removeEdge', 'canvas:forObject', 'canvas:replace',
  'study:overview', 'study:decks', 'study:deckCreate', 'study:deckPatch', 'study:deckDelete',
  'study:queue', 'study:answer', 'study:undo', 'study:cards', 'study:cardCreate', 'study:cardPatch',
  'study:cardDelete', 'study:cardsFromText', 'study:history', 'study:vocabAdd', 'study:languages',
  'study:notes', 'study:noteGet', 'study:noteCreate', 'study:notePatch', 'study:noteDelete', 'study:noteToCards',
  'dashboard:get', 'dashboard:save', 'dashboard:reset',
  'settings:get', 'settings:chooseVault', 'settings:reveal',
  'spellcheck:get', 'spellcheck:set',
  'profile:get', 'import:obsidianVault', 'export:vault',
  'people:list', 'people:get', 'people:create', 'people:self', 'people:birthdays', 'people:fields',
  'habitats:create', 'habitats:open', 'habitats:switch', 'habitats:onboard', 'habitats:delete', 'habitats:pickFolder',
  'vars:list', 'vars:save',
  'automations:list', 'automations:save', 'automations:tick', 'automations:run', 'automations:appStart', 'automations:preview',
  'telegram:get', 'telegram:save', 'telegram:test', 'telegram:poll', 'telegram:pair', 'telegram:unpair',
  'api:config', 'api:save', 'api:apply', 'api:status',
  'app:info',
  'ai:availability', 'ai:actions', 'ai:prewarm', 'ai:run', 'ai:cancel', 'ai:search', 'ai:ask',
  'habitat:code',
  'update:state', 'update:check', 'update:install',
  'automations:startup',
  'kv:get', 'kv:set',
  'files:add', 'files:get', 'files:stats', 'files:gc', 'files:pick', 'files:reveal', 'files:open', 'files:saveAs',
  'window:trafficLights',
  'tags:list', 'tags:search', 'tags:ensure', 'tags:delete',
]);

contextBridge.exposeInMainWorld('habitat', {
  /** Push updates from the main process (currently only the updater's progress). */
  onUpdateState: (fn) => {
    const handler = (_e, state) => fn(state);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.off('update:state', handler);
  },
  /** The model's reply as it's being written. Returns an unsubscribe. */
  onAiDelta: (fn) => {
    const handler = (_e, msg) => fn(msg);
    ipcRenderer.on('ai:delta', handler);
    return () => ipcRenderer.off('ai:delta', handler);
  },
  invoke: (channel, payload) => {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('Unknown channel: ' + channel));
    return ipcRenderer.invoke(channel, payload);
  },
});
