import { createContext, useContext, type ReactElement, type ReactNode, type SVGProps } from 'react';
import { ICON_VIEW_BOX, iconBodies } from './icon-data';
import { DEFAULT_ICON_STYLE, type IconStyle } from './icon-style';

// Single adapter for every application icon. The glyphs come from the Solar
// icon set (CC BY 4.0, by 480 Design), vendored as generated markup in
// icon-data.ts. Swapping icon sets means regenerating that data file; feature
// components stay untouched.
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const IconStyleContext = createContext<IconStyle>(DEFAULT_ICON_STYLE);

export function IconStyleProvider({ style, children }: { style: IconStyle; children: ReactNode }) {
  return <IconStyleContext.Provider value={style}>{children}</IconStyleContext.Provider>;
}

type IconName = keyof typeof iconBodies;

function createIcon(name: IconName) {
  const bodies = iconBodies[name];
  return function Icon({ size = 18, className, ...props }: IconProps) {
    const style = useContext(IconStyleContext);
    const labelled = Boolean(props['aria-label']);
    return (
      <svg
        {...props}
        className={className ? `app-icon ${className}` : 'app-icon'}
        data-icon-style={style}
        width={size}
        height={size}
        viewBox={ICON_VIEW_BOX}
        role={labelled ? 'img' : undefined}
        aria-hidden={labelled ? undefined : props['aria-hidden'] ?? true}
        // Compile-time constant markup from icon-data.ts; never user input.
        dangerouslySetInnerHTML={{ __html: bodies[style] }}
      />
    );
  };
}

export const AlertTriangle=createIcon('AlertTriangle'), BarChart3=createIcon('BarChart3'),
  Bell=createIcon('Bell'), CalendarDays=createIcon('CalendarDays'), CalendarRange=createIcon('CalendarRange'),
  Check=createIcon('Check'), ChevronDown=createIcon('ChevronDown'), ChevronLeft=createIcon('ChevronLeft'),
  ChevronRight=createIcon('ChevronRight'), ChevronUp=createIcon('ChevronUp'),
  CircleAlert=createIcon('CircleAlert'), Clock3=createIcon('Clock3'), Download=createIcon('Download'),
  Droplets=createIcon('Droplets'), GripVertical=createIcon('GripVertical'), History=createIcon('History'),
  Layers=createIcon('Layers'), LayoutGrid=createIcon('LayoutGrid'), List=createIcon('List'),
  Mail=createIcon('Mail'), MessageCircle=createIcon('MessageCircle'), Mic=createIcon('Mic'), Minus=createIcon('Minus'),
  MonitorDown=createIcon('MonitorDown'), Pause=createIcon('Pause'), Pencil=createIcon('Pencil'), Pin=createIcon('Pin'),
  Play=createIcon('Play'), Plug=createIcon('Plug'), Plus=createIcon('Plus'), RefreshCw=createIcon('RefreshCw'),
  Repeat=createIcon('Repeat'), RotateCcw=createIcon('RotateCcw'), Search=createIcon('Search'), Send=createIcon('Send'),
  Settings=createIcon('Settings'), Sparkles=createIcon('Sparkles'), Square=createIcon('Square'),
  SquareKanban=createIcon('SquareKanban'), Timer=createIcon('Timer'), Trash2=createIcon('Trash2'),
  Unplug=createIcon('Unplug'), X=createIcon('X');

export type AppIcon = (props: IconProps) => ReactElement;
