# Focus Fullscreen Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the transparent fullscreen focus layer with an opaque warm-white static geometric background.

**Architecture:** Keep all timer behavior unchanged. Add an aria-hidden decoration layer to `FocusFullscreenLayer` and style it exclusively with existing design tokens and static CSS shapes.

**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright.

---

### Task 1: Fullscreen background presentation

**Files:**
- Modify: `src/focus/FocusFullscreenLayer.tsx`
- Modify: `src/focus/FocusFullscreenLayer.test.tsx`
- Modify: `src/app/styles.css`
- Modify: `tests/nowly-focus-timer.spec.ts`

- [ ] Add a failing component test asserting an aria-hidden decoration layer with three shapes.
- [ ] Run `npm test -- src/focus/FocusFullscreenLayer.test.tsx` and verify failure because the decoration layer is absent.
- [ ] Add `.focus-fullscreen__background` with three aria-hidden shape elements before readable content.
- [ ] Add opaque `#F8F6F2` background, static token-colored circles, dark warm timer text and token-compliant controls; ensure shapes use `pointer-events:none` and no gradients/motion.
- [ ] Extend Playwright assertions for computed opaque background and `backgroundImage: none`.
- [ ] Run component tests, all Vitest tests, build, focus Playwright tests and Rust tests.
- [ ] Commit with `feature: add warm focus fullscreen background`.
