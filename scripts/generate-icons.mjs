// Regenerates src/components/icon-data.ts from the Solar icon set (CC BY 4.0,
// by 480 Design), shipped as Iconify JSON. Run `npm run icons` after changing
// ICON_SOURCES.
//
// Solar is a 24px-grid set drawn in the same three styles the design baseline
// asks for, and its duotone variant tones parts of the glyph itself instead of
// stacking the glyph on a filler shape.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iconsJson = join(here, '..', 'node_modules', '@iconify-json', 'solar', 'icons.json');
const outFile = join(here, '..', 'src', 'components', 'icon-data.ts');

// Solar variant suffix per icon style.
const STYLE_SUFFIX = {
  duotone: 'bold-duotone',
  solid: 'bold',
  outline: 'linear'
};

// Application icon name -> Solar base name.
const ICON_SOURCES = {
  AlertTriangle: 'danger-triangle',
  BarChart3: 'chart-2',
  Bell: 'bell',
  CalendarDays: 'calendar',
  CalendarRange: 'calendar-minimalistic',
  Check: 'check-circle',
  ChevronDown: 'alt-arrow-down',
  ChevronLeft: 'alt-arrow-left',
  ChevronRight: 'alt-arrow-right',
  ChevronUp: 'alt-arrow-up',
  CircleAlert: 'danger-circle',
  Clock3: 'clock-circle',
  Download: 'download-minimalistic',
  Droplets: 'waterdrop',
  FileText: 'file-text',
  GripVertical: 'menu-dots',
  History: 'history',
  Layers: 'layers-minimalistic',
  LayoutGrid: 'widget-5',
  List: 'list',
  Mail: 'letter',
  MessageCircle: 'chat-round-dots',
  Mic: 'microphone',
  Minus: 'minus',
  MonitorDown: 'monitor',
  Paperclip: 'paperclip',
  Pause: 'pause',
  Pencil: 'pen-2',
  Pin: 'pin',
  Play: 'play',
  Plug: 'plug-circle',
  Plus: 'add',
  RefreshCw: 'refresh',
  Repeat: 'repeat',
  RotateCcw: 'restart',
  Search: 'magnifer',
  Send: 'plain-3',
  Settings: 'settings',
  Sparkles: 'magic-stick-3',
  Square: 'stop',
  SquareKanban: 'widget-2',
  Timer: 'stopwatch',
  Trash2: 'trash-bin-trash',
  Unplug: 'link-broken-minimalistic',
  X: 'close'
};

const set = JSON.parse(readFileSync(iconsJson, 'utf8'));
if (set.width !== 24 || set.height !== 24) {
  throw new Error(`expected a 24x24 grid, got ${set.width}x${set.height}`);
}

function body(base, style) {
  const name = `${base}-${STYLE_SUFFIX[style]}`;
  // Iconify stores some variants as aliases pointing at a shared glyph.
  const resolved = set.aliases?.[name]?.parent ?? name;
  const icon = set.icons[resolved];
  if (!icon) throw new Error(`missing Solar icon "${name}"`);
  if (icon.width || icon.height) throw new Error(`"${name}" overrides the 24x24 grid`);
  return icon.body.replace(/\s+/g, ' ').trim();
}

const entries = Object.entries(ICON_SOURCES)
  .map(([name, base]) => {
    const styles = Object.keys(STYLE_SUFFIX)
      .map((style) => `    ${style}: '${body(base, style)}'`)
      .join(',\n');
    return `  // ${base}\n  ${name}: {\n${styles}\n  },`;
  })
  .join('\n');

const output = `// GENERATED FILE — do not edit by hand.
// Run \`npm run icons\` to regenerate from the Solar icon set (CC BY 4.0, by
// 480 Design). Each entry holds the inner SVG markup of one glyph on a
// 0 0 24 24 grid, in the three styles the app can switch between.
import type { IconStyle } from './icon-style';

export const ICON_VIEW_BOX = '0 0 24 24';

export const iconBodies = {
${entries}
} satisfies Record<string, Record<IconStyle, string>>;
`;

writeFileSync(outFile, output, 'utf8');
console.log(`wrote ${Object.keys(ICON_SOURCES).length} icons x 3 styles to ${outFile}`);
