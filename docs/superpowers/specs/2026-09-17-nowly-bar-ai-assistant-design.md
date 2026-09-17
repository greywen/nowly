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

The composer replaces and covers the status content while active. It receives
focus after the opening transition. The status capsule does not open its status
details while the composer owns the header.

Submitting non-empty text grows the same rail into the existing full-height
sheet using the status sheet's width, height, easing, and duration. The sheet
first shows the submitted user message and the existing safe waiting state,
then renders the assistant response, records, or editable operation plan.
The composer remains available at the bottom for follow-up turns.

Closing the assistant collapses the sheet first and then returns the header to
the normal status capsule and logo. An unsent draft survives assistant sheet
collapse during the current mounted session. Escape closes the full sheet; when
only the composer is open, Escape returns directly to the status capsule.

## Architecture

`StatusIslandApp` owns the rail surface mode:

- `status`: existing status capsule and status detail sheet.
- `composer`: full-width compact assistant composer over the rail header.
- `assistant`: full-height assistant sheet after a request is submitted.

`TopRail` remains the visual shell. Its logo becomes a real button and it gains
an assistant header/body slot. `AssistantDock` keeps ownership of assistant
conversation state, plan confirmation, history, undo, cancellation, and draft.
It exposes host callbacks for request submission and panel collapse so the rail
can coordinate its native height without duplicating assistant logic.

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

## Accessibility and motion

The logo is a button named `Nowly`. The composer textarea keeps the existing
`告诉 Nowly 你想做什么` label. `aria-expanded` reflects whether the assistant
sheet is open. Focus moves to the composer after the logo transition and is
returned to the logo when the compact composer closes.

No new motion language is introduced. The horizontal composer reveal and
vertical assistant sheet growth reuse the rail's approved grow/shrink tokens.
Reduced-motion users receive zero-duration transitions through the existing
media query.

## Verification

Frontend component tests cover logo activation, full-width composer takeover,
focus, Escape, request submission, immediate user-message/waiting rendering,
sheet growth, collapse, and preservation of status behavior.

Rust tests cover the restored Nowly panel source, source switching, and native
size selection. Focused frontend and Rust tests run before full frontend tests,
Rust tests, the production build, formatting, and diff checks.
