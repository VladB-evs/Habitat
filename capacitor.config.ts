import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iOS shell.
 *
 * This wraps the same `dist/` the desktop app loads — there is no second
 * codebase. What it does *not* wrap is the vault: an iOS webview has no Node
 * and no SQLite, so the app reaches its data over the network through the
 * bridge in electron/devbridge.js. See docs/mobile-plan.md.
 */
const config: CapacitorConfig = {
  appId: 'com.habitat.app',
  appName: 'Habitat',
  webDir: 'dist',

  ios: {
    /**
     * The web layer draws all the way to the edges and the CSS handles the
     * notch and home indicator itself, through the `--safe-*` tokens and
     * `viewport-fit=cover`. Letting iOS inset the content instead would leave
     * bands of background at both ends.
     */
    contentInset: 'never',
  },

  plugins: {
    Keyboard: {
      /**
       * `none` on purpose, and it matters.
       *
       * The other modes resize the webview when the keyboard appears, which
       * hides the keyboard from `visualViewport` — and the whole shell in
       * src/layout.tsx is built on `visualViewport` reporting it, so that the
       * action pill rides above the keyboard and the focused pane of a split
       * keeps its room. Let iOS do the resizing and none of that fires.
       */
      resize: 'none' as any,
    },
  },
};

export default config;
