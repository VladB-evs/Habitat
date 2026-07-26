# Codebase Overview - Habitat Application

This repository appears to be the source code for a sophisticated, modern web application, likely a knowledge management or note-taking tool named "Habitat." The structure suggests a component-based architecture typical of large-scale React applications.

## 📁 Structure Summary

The core logic resides in the `src/` directory, which is highly organized:

### `src/components/` (UI Building Blocks)
This directory contains the reusable, presentational pieces of the application:
*   **`Editor.tsx`**: Likely the main text/canvas area where content is created.
*   **`Dashboard.tsx` / `DailyNotes.tsx`**: Views for high-level summaries or daily tracking.
*   **`Sidebar.tsx` / `PropsPanel.tsx`**: Contextual panels for navigation, properties, or metadata.
*   **`MentionChip.tsx` / `MentionList.tsx`**: Functionality related to linking/tagging other pages within the knowledge base.

### `src/widgets/` (Extensible Modules)
These are pluggable units that add specific features to the application:
*   **`Habitats.tsx`**: Core structure/grouping mechanism.
*   **`Timer.tsx` / `Clock.tsx`**: Time-related utilities.
*   **`Custom.tsx`**: A placeholder or customizable widget area.

### Core Logic & State Management
These files handle the application's backbone:
*   **`store.tsx`**: Manages the global application state.
*   **`types.ts`**: Defines the TypeScript structures and data shapes used throughout the app.
*   **`api.ts`**: Handles all communication with the backend or persistence layer.
*   **`slash.ts` / `mention.ts`**: Logic behind slash commands (`/`) and page mentions (`@`).

## 🛠️ Root & Configuration Files
*   **`package.json` / `tsconfig.json`**: Standard dependency and compiler configuration.
*   **`vite.config.ts`**: Bundling configuration for development and production builds.

---
**In essence, this is a well-structured, TypeScript-based application combining a rich editor with modular, component-driven views and integrated knowledge-linking features.**