# Nowly Bar AI Assistant Design

## Goal

Restore the existing natural-language calendar and task assistant through the
Nowly Bar without restoring the old standalone quick-panel window or the main
application's bottom composer.

## Interaction

The collapsed Nowly Bar contains the status capsule on the left and the Nowly
logo button on the right. Clicking the logo starts a horizontal morph from the
logo and expands the composer across the complete current bar width: from the
left edge of the status capsule to the right edge of the rightmost action
button. Today the logo is the rightmost and only action button. Future buttons
extend that same right boundary without changing the composer contract.

The composer replaces and covers the status content while active. The Nowly
logo fades out with the existing rail transition and is neither clickable nor
keyboard-focusable until the assistant is hidden again. The composer receives
focus after the opening transition. It has no leading decorative icon and no
history button. Its single trailing assistant action shows voice input for an
empty draft and switches immediately to send when the draft contains text. The
status capsule does not open its status details while the composer owns the
header. The embedded composer adds no focus border, ring, shadow, or active
decoration beyond the existing rail surface.

Submitting non-empty text grows the same rail into the existing full-height
sheet using the status sheet's width, height, easing, and duration. The sheet
first shows the submitted user message and the existing safe waiting state,
then renders the assistant response, records, or editable operation plan.
The composer remains available at the bottom for follow-up turns.
The embedded sheet has no `当前聊天` header, chat icon, count badge, collapse
button, or empty `今天还没有对话。` message; its content starts directly below
the composer.

Escape is the explicit exit path and returns the header to the normal status
capsule and visible logo. Clicking outside the rail or moving focus to another
window does not close the embedded conversation. Escape hides rather than
resets the assistant: unsent drafts, completed turns, expanded answer/preview
state, and an in-flight model request survive during the current mounted
session. Clicking the restored logo reopens the exact state that was hidden.
The embedded header does not render a separate collapse button, and Escape
works from the textarea, voice/send/stop action, or any control inside the
assistant.

## Architecture

`StatusIslandApp` owns the rail surface mode:

- `status`: existing status capsule and status detail sheet.
- `composer`: full-width compact assistant composer over the rail header.
- `assistant`: full-height assistant sheet after a request is submitted.

`TopRail` remains the visual shell. Its logo becomes the entry button but is
hidden below the embedded assistant surface while that surface is active.
`TopRail` also gains an assistant header/body slot. `AssistantDock` keeps
ownership of assistant conversation state, plan
confirmation, history, undo, cancellation, and draft. The embedded Nowly Bar
presentation omits the history entry without removing history from the full
assistant presentation. It exposes host callbacks for request submission and
panel collapse so the rail can coordinate its native height without duplicating
assistant logic.

The native `quick_panel` controller restores `PanelSource::Nowly`. The logo
opening only activates the WebView composer and keeps the native window at
40px. Submission invokes the Nowly panel command, which resizes the existing
window to 288px high before the CSS grow animation begins. There is still only
one floating native window.

## Safety and error handling

Existing assistant boundaries remain unchanged:

- Calendar and task writes require an editable preview and explicit confirm.
- External calendar records remain read-only.
- Provider credentials stay in the Rust backend.
- Cancelling or closing does not execute a pending plan.
- Connection errors render in the assistant sheet and never expose API keys.

If model configuration is incomplete, submission opens the assistant sheet and
shows the existing configuration guidance. The Nowly Bar cannot open the main
settings dialog directly because it is a separate native window; the guidance
must tell the user to configure the model in the main application.

The Nowly Bar is an approved assistant runtime surface. The Rust IPC boundary
therefore permits `quick-panel-handle` to read the redacted model configuration,
interpret requests, cancel work, revise/cancel/execute/undo plans, and read
history/status. Changing the endpoint, Model ID, permissions, or encrypted Key
remains restricted to the `main` window. Other WebView labels remain denied.
This fixes the misleading desktop error that previously appeared because the
runtime still treated the restored Nowly Bar assistant as a forbidden status
window.

## Border treatment

Within the Nowly Bar, the sheet/composer divider and the status detail panel
may retain their existing dashed structural dividers. Chat content uses a
quieter treatment:

- user and assistant message bubbles have no border;
- message text remains vertically centred and left aligned;
- operation cards and their internal details do not use dashed borders;
- ordinary information cards use either no divider or the weak solid divider
  from `design.md`.

The rule is scoped to the embedded Nowly Bar presentation. The main-window
assistant and unrelated application controls keep their existing border
treatment.

## Chat operation layout

A completed operation is represented by one expandable row rather than a
separate header and `查看详情` button. The left side shows the operation kind
and its title/content. The right side shows the neutral gray status and a Solar
chevron. The entire row is the trigger and preserves `aria-expanded`,
`aria-controls`, and keyboard activation.

Operation statuses in the embedded Nowly Bar are plain gray text. They do not
use colored text, colored pills, or colored backgrounds.

Calendar operation details keep the `分类` field but omit the `颜色` field.
Task operation details are unchanged.

When a pending plan needs user action, its controls are a compact sticky
toolbar floating at the bottom-right of the embedded panel. Text buttons remain
40px high and use compact horizontal padding and shorter visible labels so the
toolbar does not occupy the full panel width. The main-window assistant keeps
its existing full-width action footer.

## Accessibility and motion

The logo is a button named `Nowly`. While the compact composer or assistant
sheet is active it is marked hidden and removed from keyboard focus. The
composer textarea keeps the existing `告诉 Nowly 你想做什么` label. Focus moves
to the composer after the logo transition. The voice, send, and stop actions
retain explicit accessible names. Escape is handled by the whole embedded
assistant rather than only the textarea and restores the status surface.

No new motion language is introduced. The horizontal composer reveal and
vertical assistant sheet growth reuse the rail's approved grow/shrink tokens.
The embedded assistant container starts at the collapsed `40px` rail height
and grows only when the native sheet-open event sets the rail to open, so its
content is revealed by the same height transition instead of appearing before
the white sheet catches up.
Reduced-motion users receive zero-duration transitions through the existing
media query.

## Verification

Frontend component tests cover logo activation and hiding, Escape restoration,
full-width composer takeover, exact answer/preview-state restoration, draft
preservation, background request continuation,
outside-click persistence, the voice/send action swap, omission of compact
decorative/history controls, focus, Escape, request submission, immediate
user-message/waiting rendering, sheet growth, collapse, and preservation of
status behavior.

Rust tests cover the restored Nowly panel source, source switching, and native
size selection. They also cover the assistant window allowlist: the main window
retains configuration access, `quick-panel-handle` gains runtime-only access,
and unknown windows remain denied. Browser checks verify the Nowly Bar assistant
and status detail dividers compute to dashed borders. Focused frontend and Rust
tests run before full frontend tests, Rust tests, the production build,
formatting, and diff checks.
