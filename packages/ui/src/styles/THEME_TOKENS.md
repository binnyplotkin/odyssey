# Odyssey Theme Tokens

`themes/ocean.css` is the source of truth for runtime theme variables. New UI
should use the canonical tokens below. Compatibility aliases remain available so
older surfaces can migrate gradually.

## Canonical Color Tokens

Surfaces:
- `--background`
- `--sidebar`
- `--surface-1`
- `--surface-2`
- `--surface-hover`
- `--surface-active`
- `--canvas-surface`

Text:
- `--foreground`
- `--text-primary`
- `--text-secondary`
- `--text-tertiary`
- `--text-quaternary`
- `--text-placeholder`

Lines and controls:
- `--border-subtle`
- `--border-medium`
- `--border-active`
- `--border`
- `--control-bg`
- `--control-border`
- `--popover-bg`
- `--popover-border`

Brand and status:
- `--accent`
- `--accent-strong`
- `--accent-secondary`
- `--accent-on`
- `--status-live`
- `--status-draft`
- `--status-archived`
- `--status-error`
- `--status-processing`
- `--status-info`

Supporting semantic hues:
- `--emissive-mint`
- `--signal-blue`
- `--event-violet`
- `--warning-amber`
- `--critical-crimson`

Derived fills:
- `--ink-wash`, `--ink-soft`, `--ink-fill`, `--ink-line`, `--ink-edge`
- `--accent-wash`, `--accent-fill`, `--accent-border`, `--accent-glow`, `--accent-soft`
- `--critical-wash`, `--critical-fill`, `--critical-border`

Materials and effects:
- `--material-surface`
- `--material-card`
- `--canvas-atmosphere`
- `--page-atmosphere`
- `--shadow`
- `--elevation-surface`
- `--elevation-card`
- `--elevation-panel`
- `--elevation-modal`
- `--elevation-menu`
- `--elevation-side`

## Compatibility Aliases

Use the canonical token in new code:

| Alias | Canonical replacement |
|---|---|
| `--app-background` | `--background` |
| `--node-canvas` | `--canvas-surface` |
| `--divider` | `--border-subtle` |
| `--panel` | `--surface-1` |
| `--panel-strong` | `--surface-active` |
| `--card` | `--material-surface` |
| `--card-hover` | `--surface-hover` |
| `--card-border` | `--border-subtle` |
| `--input-bg` | `--control-bg` |
| `--input-border` | `--control-border` |
| `--dropdown-bg` | `--popover-bg` |
| `--dropdown-border` | `--popover-border` |
| `--surface-material` | `--material-surface` |
| `--card-material` | `--material-card` |
| `--canvas-background` | `--canvas-atmosphere` |
| `--app-atmosphere` | `--page-atmosphere` |
| `--muted` | `--text-tertiary` |
| `--dim` | `--text-quaternary` |
| `--passive-teal` | `--accent` |
| `--active-teal` | `--accent-strong` |
| `--neural_color` | `--accent` |
| `--success` | `--status-live` |
| `--danger` | `--status-error` |
| `--forest-*` | semantic surface/accent tokens |

## Usage Guidance

- Prefer semantic tokens over raw hex values in app components.
- Use `--surface-1` for ordinary panels and `--surface-2` for raised stages or
  canvases.
- Use `--surface-hover` and `--surface-active` for interactive states.
- Use `--control-bg` / `--control-border` for fields and low-emphasis controls.
- Use `--popover-bg` / `--popover-border` for menus, dropdowns, and floating
  pickers.
- Use `--material-surface` for broad panels and `--material-card` for repeated
  item cards.
- Treat `--card` as compatibility only; new code should choose a semantic
  surface or material token directly.
- Use `--text-tertiary` for muted labels; avoid `--muted` in new code.
- Use `--status-error` for validation/errors and `--critical-crimson` only for
  stronger destructive or graph-category red.
- Use the theme debug palette in admin to inspect computed values and live-test
  overrides. It marks compatibility aliases separately.

## Theme Variants

`data-theme` controls mode: `dark` or `light`. `data-theme-variant` controls
the palette family inside that mode:

- `ocean`: current atmospheric Odyssey palette
- `clean`: clean light/dark palette with Odyssey blue-green accents
- `mono-ink`: highest-neutral ink/grayscale palette
- `mono-slate`: cool blue-gray monotone palette
- `mono-graphite`: neutral graphite palette
- `mono-mist`: soft green-gray monotone palette
- `mono-deep`: deeper low-chroma green monotone palette
- `river`: warm neutral palette with Ocean blue-green accents

The admin theme debugger writes `data-theme-variant` to the document root and
persists it in `localStorage` as `odyssey-theme-variant`.
