// A simple accessible multi-select rendered as a fieldset of native checkboxes.
// Used for a card's tags and collaborators so keyboard users get real controls
// and no custom widget behaviour is required. Shows a static empty hint when no
// options exist yet.
type MultiOption = { id: string; label: string };

export function KanbanMultiSelect({
  legend,
  options,
  selected,
  disabled = false,
  emptyHint,
  onToggle
}: {
  legend: string;
  options: MultiOption[];
  selected: string[];
  disabled?: boolean;
  emptyHint: string;
  onToggle: (id: string, next: boolean) => void;
}) {
  return (
    <fieldset className="kanban-multiselect">
      <legend>{legend}</legend>
      {options.length === 0 ? (
        <p className="kanban-multiselect__empty">{emptyHint}</p>
      ) : (
        <div className="kanban-multiselect__options">
          {options.map((option) => (
            <label key={option.id} className="form-check form-check-custom form-check-solid">
              <input
                className="form-check-input"
                type="checkbox"
                checked={selected.includes(option.id)}
                disabled={disabled}
                onChange={(event) => onToggle(option.id, event.target.checked)}
              />
              <span className="form-check-label">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
