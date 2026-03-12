# ClearMind

A focused writing app for macOS. No toolbars, no clutter — just a calm space to write.

ClearMind strips away everything that isn't writing. It opens to a blank page, saves automatically, and stays out of your way.

## Features

- Distraction-free editor with markdown support
- Automatic saving
- Light and dark themes
- Adjustable font size
- Command palette for quick access to settings
- Per-entry organization with a discreet navigation indicator

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI](https://tauri.app/start/)

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Built With

- [Tauri v2](https://tauri.app/) — native desktop shell
- [React 19](https://react.dev/) — UI
- [Lexical](https://lexical.dev/) — editor framework
- [Vite](https://vite.dev/) — build tooling
- [Rust](https://www.rust-lang.org/) — backend logic and file system access
