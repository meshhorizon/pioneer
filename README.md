# Pioneer

A full-featured production web browser built with [Electrobun](https://electrobun.dev) and Bun.

## Quick Start

```bash
bun install
bun start
```

## Development

```bash
bun run dev    # Run in development mode
bun run build  # Build the app
bun run lint   # TypeScript type check
bun test       # Run tests
```

## Architecture

Pioneer uses Electrobun's architecture:
- **Bun process** (`src/bun/`) - Main application logic, tab management, system APIs
- **Browser views** (`src/mainview/`) - UI chrome rendered in system WebView
- **Typed RPC** for communication between processes

## Tech Stack

- [Electrobun](https://electrobun.dev) - Desktop app framework (Bun + system WebView)
- [Bun](https://bun.sh) - JavaScript runtime and bundler
- TypeScript - Type-safe development
