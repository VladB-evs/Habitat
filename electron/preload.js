const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'types:list', 'types:create', 'types:update', 'types:delete',
  'objects:list', 'objects:get', 'objects:create', 'objects:update', 'objects:delete', 'objects:search',
  'objects:createFromTemplate', 'objects:bulkDelete', 'objects:bulkSetProp',
  'templates:list', 'templates:get', 'templates:create', 'templates:update', 'templates:delete',
  'tasks:forDay',
  'daily:get', 'daily:create', 'daily:list',
  'backlinks:list', 'graph:data', 'stats:get',
  'dashboard:get', 'dashboard:save', 'dashboard:reset',
  'settings:get', 'settings:chooseVault', 'settings:reveal',
  'profile:get', 'import:obsidianVault',
  'habitats:create', 'habitats:open', 'habitats:switch', 'habitats:onboard', 'habitats:delete', 'habitats:pickFolder',
  'vars:list', 'vars:save',
  'automations:list', 'automations:save', 'automations:tick', 'automations:run', 'automations:appStart',
  'telegram:get', 'telegram:save', 'telegram:test', 'telegram:poll',
  'api:config', 'api:save', 'api:apply', 'api:status',
  'app:info',
  'habitat:code',
  'update:state', 'update:check', 'update:install',
  'automations:startup',
  'kv:get', 'kv:set',
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
  invoke: (channel, payload) => {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('Unknown channel: ' + channel));
    return ipcRenderer.invoke(channel, payload);
  },
});
