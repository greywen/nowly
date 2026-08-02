# Nowly Note Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver persisted note creation, editing, permanent deletion, pinning, fixed colors, dashboard summaries, and an internally scrolling all-notes dialog.

**Architecture:** Move notes out of startup bootstrap into a dedicated `useNotes` feature owner. React dialogs edit copied drafts and call typed repository methods; Rust validates and normalizes note drafts and performs SQLite CRUD in Immediate transactions. Both dashboard and manager consume the same sorted note resource.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tauri 2, Rust, rusqlite/SQLite, lucide-react, Playwright.

---

## Completion status

| 项目 | 结果 |
|---|---|
| 状态 | **已完成**（2026-07-29） |
| React/Vitest | 28 个测试文件，125 个测试通过 |
| Rust | 46 个测试通过 |
| Playwright | 192 个测试通过（4 组视口） |
| 构建与静态检查 | `npm run build`、`git diff --check` 及禁止项扫描通过 |
| 审查 | 已按阶段 4 规格、实施计划和 `design.md` 完成内联差异审查，无阻塞项 |
| 计划偏差 | 执行环境无 subagent/Task 工具，代码审查改为内联；其余阶段门禁通过 |

## File map

- Create `src-tauri/src/notes.rs`: note validation, stable ordering, transactional CRUD, Tauri commands, Rust tests.
- Modify `src-tauri/src/models.rs`: add camelCase `NoteDraft` IPC model and serialization test.
- Modify `src-tauri/src/commands.rs`: remove the legacy read-only note query.
- Modify `src-tauri/src/main.rs`: register the note module and commands.
- Modify `src/notes/notes-model.ts`: define fixed colors and `NoteDraft`.
- Create `src/lib/note-draft.ts` and `src/lib/note-draft.test.ts`: form conversion, dirty state, validation, ordering.
- Modify `src/data/nowly-repository.ts`, `src/data/tauri-nowly-repository.ts`, and repository tests: expose note CRUD only through the repository boundary.
- Create `src/notes/useNotes.ts` and `src/notes/useNotes.test.tsx`: own note reads, retries, writes, and race-safe refresh.
- Modify `src/app/useAppBootstrap.ts` and its test: leave only settings in bootstrap.
- Modify `src/notes/NotesWidget.tsx` and its test: sorted bounded summaries and “查看全部便签”.
- Rewrite `src/modals/NoteModal.tsx` and create `src/modals/NoteModal.test.tsx`: accessible create/edit form, fixed colors, pin, discard/delete confirmation, error handling.
- Create `src/notes/NotesManagerDialog.tsx` and test: complete internally scrolling list with create/edit actions.
- Modify `src/lib/modal-store.ts`, `src/modals/ModalRoot.tsx`, and tests: note create/edit/manager states and focus return.
- Modify `src/app/App.tsx` and `src/app/App.test.tsx`: connect `useNotes`, dashboard summary, and all note entry points.
- Modify `src/app/styles.css`: authoritative Good note/dialog styles without motion.
- Create `tests/nowly-notes.spec.ts`: browser persistence-contract UI path, internal scrolling, token, and no-motion checks.
- Modify `docs/00-index.md` and the roadmap after all gates pass.

### Task 1: Rust note domain and IPC

- [ ] **Step 1: Write failing Rust tests**

Add tests proving: camelCase `NoteDraft`; title trim; empty title rejection with field `title`; rejection of colors outside `yellow|blue|green|purple`; content whitespace preservation; UUID/timestamps; update preserving `created_at`; missing update/delete returning `not_found`; and ordering by `pinned DESC, updated_at DESC, id ASC`.

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml notes`
Expected: FAIL because `notes` and `NoteDraft` do not exist.

- [ ] **Step 3: Implement minimal Rust note domain**

Add:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub title: String,
    pub content: String,
    pub color: String,
    pub pinned: bool,
}
```

Implement `validate_and_normalize`, `list`, `create`, `update`, and `delete` in `src-tauri/src/notes.rs`. Writes use `TransactionBehavior::Immediate`; IDs use UUID; timestamps use RFC3339 milliseconds; command errors expose stable Chinese messages.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml notes`
Expected: PASS.

- [ ] **Step 5: Register commands and run all Rust tests**

Register `list_notes`, `create_note`, `update_note`, `delete_note`; remove the old `commands::list_notes` implementation.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/notes.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feature: add persisted note commands"
```

### Task 2: Frontend note contracts and feature owner

- [ ] **Step 1: Write failing model/repository/hook tests**

Tests must assert the exact IPC calls:

```ts
['create_note', { draft }]
['update_note', { id: 'n1', draft }]
['delete_note', { id: 'n1' }]
```

Hook tests must prove independent initial loading, stable pin/update ordering, retry after read failure, refresh after each successful write, retained data on refresh failure, and no duplicate note load from `useAppBootstrap`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/note-draft.test.ts src/data/tauri-nowly-repository.test.ts src/notes/useNotes.test.tsx src/app/useAppBootstrap.test.tsx`
Expected: FAIL because note drafts, writes, and `useNotes` are absent.

- [ ] **Step 3: Implement minimal contracts and hook**

Define:

```ts
export type NoteColor = 'yellow' | 'blue' | 'green' | 'purple';
export type NoteDraft = { title: string; content: string; color: NoteColor; pinned: boolean };
```

Add `createNote`, `updateNote`, `deleteNote` to `NowlyRepository`; implement Tauri invocations. Add pure form helpers and `sortNotes` using pinned, descending `updatedAt`, then ID. Add race-safe `useNotes` with `notes`, `retryNotes`, and CRUD methods. Remove note loading from `useAppBootstrap`.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notes/notes-model.ts src/lib/note-draft.ts src/lib/note-draft.test.ts src/data src/notes/useNotes.ts src/notes/useNotes.test.tsx src/app/useAppBootstrap.ts src/app/useAppBootstrap.test.tsx
git commit -m "feature: add note feature state"
```

### Task 3: Dashboard summaries and all-notes manager

- [ ] **Step 1: Write failing component tests**

Prove that the widget shows ordered summaries, exposes “查看全部便签”, sends the clicked note and trigger, and keeps its body as the bounded internal scroll region. Prove the manager lists every ordered note in its own scrollable body, opens create/edit, handles empty state, closes with Escape, traps focus, and restores focus.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/notes/NotesWidget.test.tsx src/notes/NotesManagerDialog.test.tsx`
Expected: FAIL because manager and entry point are absent.

- [ ] **Step 3: Implement minimal components**

Use semantic buttons and Lucide `Plus`, `Pin`, and `X`. Dashboard note content is text-clamped; the complete collection is available only inside `NotesManagerDialog`, whose body owns overflow.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notes/NotesWidget.tsx src/notes/NotesWidget.test.tsx src/notes/NotesManagerDialog.tsx src/notes/NotesManagerDialog.test.tsx
git commit -m "feature: add all notes manager"
```

### Task 4: Accessible note editor workflow

- [ ] **Step 1: Write failing dialog tests**

Cover create defaults, edit copy, title field error and `aria-describedby`, four native radio colors, native pinned checkbox, save draft, disabled/static “正在保存”, repository field/general errors retaining the draft, clean close, dirty Escape confirmation, edit deletion confirmation, failed deletion retained above editor, successful close, focus trap, and focus return.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/modals/NoteModal.test.tsx`
Expected: FAIL against the legacy uncontrolled drawer.

- [ ] **Step 3: Implement minimal editor**

Build `NoteModal` on shared `Dialog` and `ConfirmDialog`, following `TaskModal` behavior. No Tailwind prototype utility styling, native select, animation, or optimistic persistence.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modals/NoteModal.tsx src/modals/NoteModal.test.tsx
git commit -m "feature: add note editor workflow"
```

### Task 5: Application wiring and authoritative styles

- [ ] **Step 1: Write failing integration tests**

Add App/ModalRoot tests for header create, dashboard edit, manager open/create/edit, persisted refresh after save/delete, summary count, no duplicate initial reads, layered Escape behavior, and focus restoration.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/app/App.test.tsx src/modals/ModalRoot.test.tsx`
Expected: FAIL because App still uses bootstrap notes and create is disconnected.

- [ ] **Step 3: Wire the feature**

Extend modal state with trigger-bearing `note-create`, `note-edit`, and `notes-manager`. Connect `useNotes` to App and ModalRoot; all save/delete paths refresh once through the hook.

- [ ] **Step 4: Add design-system styles**

Add only semantic classes under `src/app/styles.css`: `.note-dialog`, `.note-form`, `.note-color-options`, `.notes-manager-dialog`, `.notes-manager-list`, pin badge, and two-line summary clamp. Reuse exact tokens, 15.2px radius, 1px borders, internal overflow, native Good solid checks, and zero motion.

- [ ] **Step 5: Verify GREEN and build**

Run:

```bash
npm test -- src/app/App.test.tsx src/modals/ModalRoot.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx src/lib/modal-store.ts src/modals/ModalRoot.tsx src/modals/ModalRoot.test.tsx src/app/styles.css
git commit -m "feature: connect note vertical slice"
```

### Task 6: Browser regression and stage closure

- [ ] **Step 1: Write failing Playwright coverage**

Create `tests/nowly-notes.spec.ts` covering empty dashboard entry points and manager layout at all configured viewports. Assert `documentElement`/`body` have no page overflow, note/manager bodies can own overflow, no transition/animation is active, and no legacy `#009EF7`, `#181C32`, or `#7E8299` appears in loaded styles.

- [ ] **Step 2: Verify RED then GREEN**

Run: `npx playwright test tests/nowly-notes.spec.ts`
Expected first: FAIL before required wiring/style assertions; after minimal fixes: PASS in all four projects.

- [ ] **Step 3: Run complete gates**

```bash
npm test
npm run build
npx playwright test
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: all PASS and clean diff check.

- [ ] **Step 4: Review stage scope**

Review changed files for validation parity, stale async responses, permanent-delete behavior, focus layering, design tokens, internal-only overflow, forbidden motion, and accidental changes to WorkerW/taskbar code. Fix every finding and rerun affected gates.

- [ ] **Step 5: Update documentation and commit**

Mark stage 4 complete and stage 5 next in `docs/00-index.md` and the roadmap, preserving all inherited contracts.

```bash
git add tests/nowly-notes.spec.ts docs/00-index.md docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md docs/superpowers/plans/2026-07-29-nowly-notes.md
git commit -m "docs: record note stage completion"
```
