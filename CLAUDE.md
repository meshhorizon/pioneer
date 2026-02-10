# Pioneer Browser - Development Guide

## Project Overview
Pioneer is a full-featured production web browser built with **Electrobun** (NOT Electron).
Electrobun uses Bun + system WebView instead of Node.js + Chromium.

## Critical Rules

### Electrobun is NOT Electron
- Do NOT use Electron APIs (ipcMain, ipcRenderer, BrowserWindow from electron, etc.)
- Do NOT use Node.js APIs - use Bun APIs instead
- Import patterns:
  - Main process (Bun): `import { BrowserWindow, BrowserView, Utils } from "electrobun/bun"`
  - Browser/view context: `import Electrobun, { Electroview } from "electrobun/view"`
- Full API reference: https://blackboard.sh/electrobun/llms.txt

### Architecture
```
src/
  bun/           # Main process (runs in Bun runtime)
    index.ts     # App entry point, window creation, RPC setup
    tabManager.ts # Tab lifecycle and webview management
    types/
      rpc.ts     # Shared RPC type definitions
  mainview/      # Browser UI (runs in system WebView)
    index.html   # Main browser chrome HTML
    index.css    # Styles
    index.ts     # UI logic, tab switching, navigation
```

### Communication Pattern
- Bun process <-> WebView communication uses **typed RPC** (not IPC)
- Define RPC schemas in `src/bun/types/rpc.ts`
- Bun side: `BrowserView.defineRPC<Schema>({ handlers: { requests: {...}, messages: {...} } })`
- View side: `Electroview.defineRPC<Schema>({ handlers: { requests: {...}, messages: {...} } })`
- Use `rpc.request.methodName(params)` for request/response
- Use `rpc.send("messageName", payload)` for fire-and-forget messages

### WebView Embedding
- Use `<electrobun-webview>` custom element to embed web content (browser tabs)
- Set `src` attribute for URL, `renderer="cef"` for CEF rendering
- Key methods: `toggleHidden(bool)`, `togglePassthrough(bool)`
- Events: `page-title-updated`, `did-navigate`, `new-window-open`

### Asset Loading
- Use `views://` protocol for bundled assets: `url: "views://mainview/index.html"`
- Views must be configured in `electrobun.config.ts` under `build.views` and `build.copy`

## Build & Run

```bash
bun install          # Install dependencies
bun run build        # Build the app
bun run dev          # Run in dev mode
bun start            # Build + run
bun run lint         # TypeScript type check
```

## Development Workflow (Git Worktrees)

Background workers MUST use git worktrees for isolated development:

```bash
# From the main repo directory, create a worktree for your feature branch:
git worktree add ../pioneer-wt-<feature-name> -b feature/<feature-name> main

# Work inside the worktree directory:
cd ../pioneer-wt-<feature-name>
bun install

# Make changes, then commit and push:
git add <files>
git commit -m "feat: description"
git push -u origin feature/<feature-name>

# Create PR:
gh pr create --title "feat: ..." --body "..."

# Clean up worktree when done:
cd /Users/bedwards/vibe/meshhorizon/pioneer
git worktree remove ../pioneer-wt-<feature-name>
```

### Workflow Steps
1. Create a git worktree with a feature branch from `main`
2. Install dependencies with `bun install` in the worktree
3. Implement the feature (keep PRs focused and small)
4. Ensure `./node_modules/.bin/tsc --noEmit` passes (TypeScript strict mode)
5. Commit with descriptive message
6. Push and create PR against `main`
7. CI must pass before merge
8. Clean up worktree after PR is merged

## Code Style

- TypeScript strict mode is enabled
- Use `type` imports: `import type { Foo } from "..."`
- No unused variables or parameters (enforced by tsconfig)
- Prefer `const` over `let`, never use `var`
- Use async/await over raw promises
- Keep files focused - one major concern per file
- Name files with camelCase (e.g., `tabManager.ts`)

## Key Electrobun APIs

### BrowserWindow (Bun process)
```typescript
const win = new BrowserWindow({
  title: "Pioneer",
  url: "views://mainview/index.html",
  frame: { width: 1400, height: 900, x: 100, y: 100 },
  rpc,
});
win.on("close", () => Utils.quit());
```

### BrowserView (Bun process)
```typescript
const webview = new BrowserView({
  url: "https://example.com",
  frame: { x: 0, y: 100, width: 1400, height: 800 },
});
webview.on("did-navigate", (event) => { /* handle */ });
webview.loadURL("https://...");
```

### Utils (Bun process)
- `Utils.quit()` - quit app
- `Utils.openExternal(url)` - open in default browser
- `Utils.showNotification({ title, body })` - system notification
- `Utils.openFileDialog(options)` - file picker
- `Utils.showMessageBox(options)` - message dialog
- `Utils.clipboardReadText()` / `Utils.clipboardWriteText(text)`

### Electroview (Browser/view context)
```typescript
import Electrobun, { Electroview } from "electrobun/view";
const rpc = Electroview.defineRPC<Schema>({ handlers: {...} });
const electrobun = new Electrobun.Electroview({ rpc });
```

## Secrets
- NEVER commit API keys or secrets
- Gemini API key is in `.env.local` (gitignored)
- Use `.env.example` as template for required env vars
- Load secrets with `Bun.env.VARIABLE_NAME` or `process.env.VARIABLE_NAME`

## Testing
- Unit tests: `bun test`
- Screenshot tests: `bun run test:screenshots` (requires Gemini API key)
- TypeScript check: `bun run lint`

## PR Guidelines
- One feature per PR, matching a GitHub issue
- Keep changes minimal and focused
- Test that the app builds: `bun run build`
- Type check passes: `bun run lint`
- Write clear commit messages describing the "why"
