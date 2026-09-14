import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';

type TipProps = {
  content: string;
  children: ReactElement<{ 'aria-describedby'?: string; onBlur?: React.FocusEventHandler; onFocus?: React.FocusEventHandler; onKeyDown?: React.KeyboardEventHandler; onMouseEnter?: React.MouseEventHandler; onMouseLeave?: React.MouseEventHandler }>;
  align?: 'center' | 'end';
};

export function Tip({ content, children, align = 'center' }: TipProps) {
  const generatedId = useId();
  const [visible, setVisible] = useState(false);
  const [escapeDismissed, setEscapeDismissed] = useState(false);
  const describedBy = [children.props['aria-describedby'], generatedId].filter(Boolean).join(' ');
  const show = () => { if (!escapeDismissed) setVisible(true); };
  const hide = () => { setVisible(false); setEscapeDismissed(false); };
  const child = cloneElement(children, {
    'aria-describedby': visible ? describedBy : children.props['aria-describedby'],
    onMouseEnter: (event) => { children.props.onMouseEnter?.(event); show(); },
    onMouseLeave: (event) => { children.props.onMouseLeave?.(event); hide(); },
    onFocus: (event) => { children.props.onFocus?.(event); show(); },
    onBlur: (event) => { children.props.onBlur?.(event); if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) hide(); },
    onKeyDown: (event) => { children.props.onKeyDown?.(event); if (event.key === 'Escape') { setVisible(false); setEscapeDismissed(true); } }
  });
  return (
    <span className={`tip tip--${align}`} onMouseEnter={show} onMouseLeave={hide}>
      {child}
      {visible ? <span id={generatedId} className="tip__bubble" role="tooltip">{content}</span> : null}
    </span>
  );
}
