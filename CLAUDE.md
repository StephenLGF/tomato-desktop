# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project overview

Tomato Desktop is a local-first Tauri 2 desktop application for AI agents. It combines a React/TypeScript frontend with a Rust/Tokio backend, SQLite/SeaORM persistence, built-in and external MCP servers, browser automation, workspace tools, skills, and scheduled/multi-agent workflows. The product is derived from LibrAgent, so historical documentation and compatibility identifiers may still use the `LibrAgent` name; use the source and `src-tauri/tauri.conf.json` for current product/runtime identifiers.

The main application lives at the repository root. The desktop boundary is Tauri: React renders the UI and calls typed frontend service modules, while Rust owns native operations, persistence, agent workflow state, and tool execution.

## Toolchain and setup

- Node.js 20+ and **pnpm 9.15.9** are required. The version is pinned in `package.json` and enforced by `scripts/enforce-pnpm-version.cjs`.
- Install the pinned package manager and dependencies with:

  ```bash
  corepack enable
  corepack prepare pnpm@9.15.9 --activate
  pnpm install --frozen-lockfile
  ```

- Install Rust through rustup. Linux Tauri development also requires the WebKitGTK/GTK/AppIndicator packages listed in `CONTRIBUTING.md` and `.github/workflows/ci.yml`.
- Model/provider credentials and settings are configured in the application Settings UI. Do not assume a `.env` file is part of the normal developer workflow.

## Common commands

### Run and build

```bash
pnpm dev                 # Vite frontend only; http://localhost:1420
pnpm tauri dev           # Full Tauri application with Rust backend and hot reload
pnpm tauri:mcp           # Tauri development with LIBRAGENT_MCP_ENABLE=1
pnpm build               # Synchronize generated files, type-check, and build the frontend
pnpm build:nosync        # Type-check and build without synchronization
pnpm tauri build         # Package the desktop app for the current platform
pnpm preview             # Preview the Vite production build
```

`pnpm dev` and `pnpm build` regenerate `src/lib/generated/builtin-services.ts` and `src/lib/generated/execution-mode.ts`. Change the source/configuration used by `scripts/sync-*.cjs`, not generated output.

### Frontend checks and tests

```bash
pnpm lint
pnpm lint:fix
pnpm format                         # Apply Prettier
pnpm format:check
pnpm tsc --noEmit                   # Strict TypeScript check
pnpm test                           # Vitest watch mode
pnpm test:run                       # All frontend tests once
pnpm test:run:validate              # Serial/low-memory validation wrapper
pnpm test:run -- src/path/file.test.ts
pnpm test:run -- src/path/file.test.ts -t "test name"
```

Vitest is configured in `vitest.config.ts` with a `jsdom` environment, `src/test/setup.ts`, the `@/*` alias to `src/*`, and normal file parallelism. If workers exhaust memory, use `pnpm test:run:validate` (it sets `LIBRAGENT_LOW_MEMORY_VALIDATE=1`).

### Rust checks and tests

Use the repository wrappers rather than ad-hoc Cargo commands for routine checks. `scripts/run-rust-command.cjs` bounds build parallelism and configures the expected test profile/threading for this large crate.

```bash
pnpm rust:fmt
pnpm rust:fmt:check
pnpm rust:check
pnpm rust:check:all
pnpm rust:clippy
pnpm rust:clippy:all
pnpm rust:test                         # Integration tests in src-tauri/tests/
pnpm rust:test -- test_name             # Filter Rust tests
pnpm rust:test:edit-file                # Alternate workspace-edit-file feature
```

`src-tauri` disables library unit tests because the library is also built as a cdylib. Backend tests belong in `src-tauri/tests/` and are run as integration tests; do not rely on `#[cfg(test)]` blocks in the library being exercised by CI.

### Repository validation and generated/configured content

```bash
pnpm refactor:prepare              # Synchronize and format generated/source content
pnpm refactor:validate             # Full local validation pipeline
pnpm refactor:validate:legacy      # Older broader pipeline
pnpm sync-builtin-services
pnpm sync-execution-mode
pnpm assistants:validate
pnpm skills:audit
pnpm skills:mirror:check
pnpm tool-names:check
pnpm perf:bundle
pnpm dead-code
```

`refactor:validate` runs the repository's synchronization/formatting, frozen-lockfile check, lint, formatting check, frontend tests, Rust checks/tests, production build, bundle budget, dead-code, bundled-skill, tool-name, mirror, and assistant validations. Run the focused check while iterating, then run this pipeline before handing off a multi-area change. If Rust files changed, run `pnpm rust:fmt` before reporting completion.

## Architecture

### Frontend

- `src/app/main.tsx` creates the React root and global providers. `src/app/App.tsx` defines the lazy-loaded routes and top-level shell.
- `src/features/` contains feature-local UI, hooks, state, and behavior for agent chat, assistants, MCP, skills, knowledge, playbooks, repositories, scheduled tasks, settings, and other product areas.
- `src/components/` contains reusable UI/layout primitives; `src/context/` contains cross-feature providers; `src/models/` and `src/types/` define frontend contracts.
- `src/lib/backend/` is the typed Tauri IPC service layer. Domain modules mirror command areas and must call Rust through `safeInvoke()` in `src/lib/backend/core.ts`, not direct unwrapped Tauri invocation.
- `src/lib/ai-service/` provides the LLM abstraction and provider-specific streaming/tool-call adapters. It handles provider API interaction, but Agent V2 workflow control remains in Rust.

### Rust/Tauri backend

- `src-tauri/src/lib.rs` configures startup, plugins, database/state initialization, command registration, and event infrastructure.
- `src-tauri/src/commands/` exposes Tauri IPC commands. Commands should validate boundary inputs and delegate domain work to services/managers.
- `src-tauri/src/agent/` implements Agent V2 lifecycle and orchestration: sessions, workflow control, prompt/context construction, LLM response handling, compaction/recovery, approvals, concurrency, and tool execution.
- `src-tauri/src/mcp/` is the MCP substrate. Built-ins implement the `BuiltinMCPServer` contract; `MCPServiceProxy` routes calls; proxy/session managers isolate built-in state and external stdio, HTTP, SSE, and OAuth connections.
- `src-tauri/src/services/` contains domain services such as workspace/file operations, browser sidecar integration, assistants, skills, attachments, and scheduled tasks. `repositories/` and `entity/` implement SQLite/SeaORM access; schema changes belong in `src-tauri/migration/`.
- `src-tauri/src/session/`, `session_isolation/`, and lifecycle modules manage session/workspace boundaries, cleanup, recovery, and external process isolation.
- `src-tauri/bundled_skills/` and `src-tauri/bundled_assistants/` are packaged resources. Tauri includes them through the resource configuration in `src-tauri/tauri.conf.json`.

### Agent V2 data flow and ownership

Agent V2 is Rust-orchestrated and event-driven; React is primarily reactive:

1. Agent UI invokes a typed session/agent service.
2. Rust validates the request, updates the session, adds/persists the user message, and emits lifecycle events.
3. Rust builds the system prompt from assistant identity, session/context providers, skills, and service contexts, then emits an LLM completion request to the frontend/provider bridge.
4. The frontend calls the selected provider and returns the streamed/completed response through the Tauri command boundary.
5. Rust persists/parses the assistant response, routes tool calls through the session's `MCPServiceProxy`, adds tool results, and starts the next cycle.
6. Tauri events update `AgentSessionContext`/agent feature state until completion, pause, cancellation, or error.

Rust owns authoritative workflow state and SQLite persistence, with an in-memory per-session message cache for active context. React owns presentation, optimistic updates, and streaming display state. Keep planning, browser, workspace, knowledge, and external MCP state session-scoped; never introduce shared mutable tool state across sessions.

The repository also contains legacy React-oriented chat paths. When changing chat behavior, determine whether the path is legacy Chat V1 or Agent V2 before changing orchestration or state ownership.

### MCP and prompt contracts

- Agent-visible information must be in MCP `content` text. `structured_content` is a LibrAgent UI extension and is not a dependable channel for information the model needs in a follow-up call.
- `ServiceContext.context_prompt` is what reaches the model's system prompt; do not put model-critical IDs or state only in `structured_state`.
- Built-in tools should follow existing `MCPResult`/error conventions and make IDs, paths, statuses, and actionable follow-up information readable from text alone.

## Coding conventions and boundaries

- Use 2-space formatting for TypeScript/React and `rustfmt` for Rust. Write comments and public documentation in English.
- TypeScript is strict (`tsconfig.json`). Avoid `any`, blind type assertions, unchecked `JSON.parse`, and assumptions about IPC/external responses. Prefer precise interfaces, type guards, or Zod schemas; validate data at boundaries.
- Use normal type imports rather than inline `import('...').Type` references.
- Use `getLogger` from `@/lib/logger` instead of `console.*` in application code.
- Keep frontend/backend contracts typed. Rust commands conventionally return `Result<T, String>`; built-in tools use the project's MCP result/error types.
- Keep feature behavior feature-local, use shared components only for genuinely reusable UI, and use existing backend service wrappers for IPC.
- Do not add a Content Security Policy to `src-tauri/tauri.conf.json`; this desktop configuration has historically caused blank release screens. Use Tauri capabilities/native security controls instead.

## Important reference points

- `README.md` — product scope, capabilities, onboarding, and developer quick start.
- `docs/architecture/agent-workflow-architecture.md` — detailed workflow, event, state, and session-isolation diagrams.
- `docs/api/` — Tauri/HTTP API contracts.
- `docs/guides/builtin_tool_bp.md` — built-in MCP tool design and response standards.
- `CONTRIBUTING.md` — platform setup and contribution workflow.
- `agents.md` and `.github/copilot-instructions.md` — fuller type-safety, logging, architecture, and validation conventions.

## Repository-specific caveats

- Keep pnpm at 9.15.9; another version can rewrite `pnpm-lock.yaml` and break frozen-lockfile validation.
- CI covers Ubuntu, Windows, and macOS and runs frontend checks, Rust checks, integration tests, bundled-resource checks, and Tauri builds. Cross-platform process/path/browser behavior matters.
- The normal Tauri dev URL is `http://localhost:1420`; Vite intentionally ignores `src-tauri`, `.worktrees`, and benchmark `jobs` outputs while watching.
- Credentials are configured through application settings. Trace both sides of the boundary before changing credential storage or provider IPC contracts.
