# Disable Matrix Task Tooltips

## Goal

The four-quadrant task list must not display a tooltip when a task title is hovered with a mouse or focused with a keyboard.

## Scope

- Remove tooltip state and generated tooltip identifiers from `TaskRow`.
- Remove hover, blur, focus, and mouse-leave handlers used only by the tooltip.
- Remove the tooltip DOM and its `aria-describedby` relationship.
- Remove the now-unused task tooltip CSS rules.
- Keep task completion, task editing, title truncation, and the existing inline task metadata unchanged.

## Component Behavior

`TaskRow` remains a two-line row. The checkbox toggles completion, the title button opens task editing, and the metadata line communicates due date, priority, and completion state. Hovering or focusing the title changes no content and creates no floating prompt.

Removing the tooltip also removes task-row dependencies that existed only to populate it, including linked-event lookup and priority-label formatting. The `events` prop remains part of the component interface for now to avoid an unrelated call-site refactor.

## Accessibility

The title button retains its accessible edit label and normal keyboard focus behavior. The completion checkbox retains its state-specific accessible label. No hidden or visually suppressed tooltip remains in the accessibility tree.

## Testing

- Replace the existing tooltip visibility test with a regression test asserting that neither hover nor focus creates a `tooltip` role.
- Update the completed and pending state test so it verifies keyboard focus without expecting a tooltip.
- Run the focused `TaskRow` tests, then the matrix widget tests and full unit suite.

## Error Handling

This change introduces no asynchronous operations or new error states. Existing task loading and mutation error handling is unchanged.
