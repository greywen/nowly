# Nowly Bar AI Assistant Design

## Goal

Expose the existing controlled calendar and task assistant through the Nowly
Bar as one full conversation panel. Clicking the Nowly Logo opens that panel
directly; there is no compact intermediate assistant surface.

## Interaction

The collapsed Nowly Bar is one continuous `288×40px` surface. The status action
occupies the left `240px`; the Nowly Logo action occupies the right `48px`.
Clicking the Logo immediately invokes the native Nowly panel command. When the
native open event arrives, the assistant shell morphs from the Logo footprint
to the full `408×440px` panel.

The full panel contains the existing conversation body and its input area at
the bottom. The input receives focus after opening. An empty draft shows voice
input; non-empty text swaps that action to send. Submitting a request stays in
the already-open panel and immediately adds the user message and safe waiting
state.

Escape or the right-top close button collapses the assistant through the native
close path. Drafts, conversation turns, operation previews, and in-flight work
remain owned by `AssistantDock` for the mounted session. Clicking outside the
panel does not close it.

The status detail panel remains independent at `288×288px`. Opening, closing,
or using AI must not animate status detail, acknowledge reminders, or change
the status model.

## Architecture

`StatusIslandApp` has only two rail surfaces:

- `status`: the collapsed status/Logo shell or expanded status detail.
- `assistant`: the full `408×440px` AI conversation.

There is no `composer` rail surface. `StatusIslandApp` invokes
`toggle_nowly_panel` directly from the Logo and waits for the native
`status-island-details-open` event before activating `AssistantDock`.
`AssistantDock` opens its embedded conversation whenever it becomes active and
focuses the bottom input.

`TopRail` keeps the status and assistant panels as sibling shells so each owns
its animation and content. Both expanded panels use the same
`status-rail__panel-close` close-button variant; only visibility differs by
panel ownership.

## Safety and presentation

Existing assistant boundaries do not change:

- Calendar and task writes require an editable preview and explicit confirm.
- External calendar records remain read-only.
- Provider credentials stay in the Rust backend.
- Closing never executes a pending plan.
- `quick-panel-handle` may use runtime assistant commands but cannot change
  endpoint, Model ID, permissions, or encrypted Key.

The embedded panel has no conversation header, history entry, count badge, or
empty-chat placeholder. Messages and operation cards retain the approved
Nowly Bar presentation. Calendar operation details hide only `颜色`; `分类`
remains, and task fields are unchanged.

## Accessibility and motion

The Logo is a button named `Nowly`. While the assistant is opening or open, it
is hidden and removed from keyboard navigation. The input retains the accessible
name `告诉 Nowly 你想做什么`; voice, send, stop, and close actions retain explicit
names.

The Logo-to-panel and panel-to-Logo morph uses the approved `280ms` open,
`220ms` close, and `cubic-bezier(.22, 1, .36, 1)` curve. Reduced-motion mode
sets these transitions to zero duration.

## Verification

Component tests cover direct Logo invocation, absence of a compact rail state,
native-event activation, automatic input focus, already-open submission,
Escape collapse, status isolation, and the shared close-button variant.
Browser checks cover the full `408×440px` geometry, four-corner clipping,
input/action layout, direct morph, close/reopen reversal, and identical close
button styling on status and AI panels.
