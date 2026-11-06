# Design: Mainichi

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

## System
- Genre: playful
- Shape of the first page: app screen (left sidebar with Today, Calendar and an expandable Money group holding Overview, Transactions, Assets, Analytics and Plans; account menu at the foot of the sidebar; phones keep a slim top bar and a bottom tab bar, with the Money tab row inside the Money pages)
- Theme: Hum (cream paper, blue-black ink, card-stock controls), applied at app density: one family, fixed type scale, 40px controls
- Axes: light/rounded-sans/chromatic-yellow · posture: full-palette · modes: light+dark (derived, `data-theme` or the OS)

## Tokens
`frontend/src/styles/tokens.css` is the source of truth. The roles:
```css
:root {
  --color-paper: oklch(97% 0.012 95);  --color-paper-2: oklch(94.5% 0.018 95);  --color-paper-3: oklch(91% 0.022 95);
  --color-ink: oklch(20% 0.014 255);  --color-ink-2: oklch(29% 0.014 255);  --color-muted: oklch(47% 0.014 255);  --color-rule: oklch(87% 0.016 95);
  --color-accent: oklch(87% 0.175 96);  --color-accent-ink: oklch(20% 0.014 255);  --color-focus: oklch(50% 0.17 250);
  --font-display: "Chillax", ui-rounded, ui-sans-serif, system-ui, sans-serif;  --font-body: var(--font-display);
  --radius-card: 24px;  --radius-stock: 16px;  --radius-input: 14px;  --radius-pill: 999px;  --shadow-card: 0 1px 2px oklch(20% 0.014 255 / 0.06), 0 12px 28px -14px oklch(20% 0.014 255 / 0.22);
}
```
Accent jobs: pear is the primary action and the today marker, blue is links and the focus ring, mint is done and growth, coral is the loud fill. Money in is green and money out is red, always; gain and loss follow the user's convention (`data-convention`).
The spacing scale, the type scale, the easings and the durations live in `tokens.css`.

## Surfaces
- Whitespace, then a hairline, then a tinted well (`.card`), then a raised sheet for popovers, modals and drawers. A well never holds a well.
- One ink sheet (`.mi-sheet`) carries money: the day's spend on Today and the month's spend on Money.

## Controls
- Primary: pear fill · card-stock edge that presses on `:active` · 40px (32px small)
- Secondary: card with a hairline and a solid edge · same radius and height
- Chosen tab, toggle or day: an ink pill with paper text

## Motion
- Character: brisk; one reveal at most (the year dots on sign-in); under reduced motion everything ends at once.

## Exports
`tokens.css` in this project. Tailwind, DTCG or shadcn blocks are added here on request, per `export-formats.md`.
