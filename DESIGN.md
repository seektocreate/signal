# Signal — Design Reference

> Eggshell ground, light-weight serif, near-monochrome ink. The prose is the product; the design's job is to stay out of its way and lend it weight.

Signal is a daily reading product (the digest at `/today`, the email, the archive) plus a transparency view (`/editorial-room/[date]`). The reading surfaces are typographic and spare: warm off-white background, classical serif at light weight for headlines, neutral sans for body, hairline borders, no chromatic decoration. The transparency surface inverts the density: small text, monospace blocks, tabular score data — designed to be scanned, not savored. One palette, two density modes.

## Tokens — Colors

Near-monochrome on a warm eggshell ground. The only chromatic accent is `--color-citation`, used exclusively for the underlined `@handle` links that point at original tweets.

| Token | Value | Role |
|-------|-------|------|
| `--color-eggshell` | `#fdfcfc` | Page ground — base surface for all reading views |
| `--color-powder` | `#f5f3f1` | Hover/active row, code-block fill, score-chip fill |
| `--color-chalk` | `#e5e5e5` | Universal border, divider, blockquote rule |
| `--color-fog` | `#b1b0b0` | Disabled state, dim controls |
| `--color-slate` | `#a59f97` | Tertiary text — placeholder, deemphasized labels |
| `--color-gravel` | `#777169` | Secondary body text — eyebrows, captions, dek |
| `--color-cinder` | `#575347` | Mid-tone text — secondary headings on light surfaces |
| `--color-obsidian` | `#000000` | Primary text, CTA fill |
| `--color-citation` | `#0447ff` | `@handle` link color |
| `--color-diff-removed` | `#cf222e` | Editorial Room diff: removed text |
| `--color-diff-added` | `#1a7f37` | Editorial Room diff: added text |

> **Cinder note**: this value supersedes a `#57534` (5-character) typo in earlier drafts. The corrected `#575347` keeps the warm-stone family of `--color-gravel` and `--color-slate`.

## Tokens — Typography

Three families, all on Google Fonts. One serif commitment.

### Fraunces — display & headings

Variable serif (weights 100–900, optical-size axis 9–144). Designed for editorial use. We use it at **weight 300** for display and headings — the light-weight serif is the brand signature, the same authority-through-restraint move that suits a daily editorial product. The opsz axis lets the same family carry both 40px display authority and 18px italic blockquotes without feeling like two fonts. `--font-serif`

- **Weights:** 300 (regular display/heading), 300 italic (blockquote)
- **Sizes:** 24px heading, 40px display
- **Line height:** 1.1–1.3
- **Tracking:** -0.01em at heading, -0.02em at display

### Inter — body, UI, captions

Sans-serif workhorse. Weight 400 for body and dek, weight 500 for interactive labels and emphasis, weight 700 reserved for the Editorial Room diff (the only place a true bold sans appears). The neutral sans is the right counterpart to a distinctive serif — the serif carries the voice, the sans carries the legibility. `--font-sans`

- **Weights:** 400, 500, 700
- **Sizes:** 12px caption, 16px body, 18px body-lg
- **OpenType features:** `"kern" 1`

### JetBrains Mono — dates, code, machine output

Monospace for anything that should read as machine-generated or fixed-width: archive dates, code blocks, JSON in the Editorial Room, model output dumps. `--font-mono`

- **Weights:** 400
- **Sizes:** 13px (code blocks), 14px (archive date column)

### Type scale

| Role | Size | Line height | Tracking | Family |
|------|------|-------------|----------|--------|
| caption | 12px | 1.4 | — | Inter 400 |
| body | 16px | 1.6 | — | Inter 400/500 |
| body-lg | 18px | 1.6 | — | Inter 400 (or Fraunces 300 italic for blockquote) |
| heading | 24px | 1.3 | -0.01em | Fraunces 300 |
| display | 40px | 1.1 | -0.02em | Fraunces 300 |

## Tokens — Spacing & Shapes

### Spacing — three buckets

The system intentionally has three values. If a layout needs a fourth, it usually means a component should be moved between buckets, not that a new bucket is needed. The `--spacing-*` namespace (not `--space-*`) is required for Tailwind v4 to auto-generate utility classes like `p-tight`, `gap-default`, `mt-section`.

| Token | Value | Use |
|-------|-------|-----|
| `--spacing-tight` | `8px` | Within an element — icon↔label, tag padding, table row padding |
| `--spacing-default` | `24px` | Between elements — paragraph gap, card padding, list-row vertical gap |
| `--spacing-section` | `64px` | Between page regions — header↔body, theme↔theme on `/today` |

### Border radius

| Token | Value | Element |
|-------|-------|---------|
| `--radius-input` | `4px` | Form inputs, score chips when rectangular |
| `--radius-card` | `16px` | Cards, panels, code blocks |
| `--radius-pill` | `9999px` | Buttons, score chips when round |

### Shadows — two variants

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-hairline` | `rgba(0,0,0,0.075) 0 0 0 0.5px inset` | Cards on eggshell, code blocks, score chips — replaces a border without adding visual weight |
| `--shadow-float` | `rgba(0,0,0,0.4) 0 0 1px 0, rgba(0,0,0,0.04) 0 2px 4px 0` | Modals, the rare elevated panel — hairline detachment, not depth |

## Reading column & prose

The `/today` digest is the canonical reading surface. Prose obeys a measure constraint:

- **Body measure**: `max-width: 65ch` (≈640px at 16px body, ≈720px at 18px body-lg). Centered on the eggshell ground.
- **Display headlines**: may break out to `80ch` for a wider thesis line; the body underneath returns to 65ch.
- **Below 720px viewport**: prose is full-width minus 24px gutters.
- **Body size on `/today`**: 18px body-lg with line-height 1.6. The email render uses 16px body to suit smaller mail clients.
- **Paragraph spacing**: `--spacing-default` (24px) between paragraphs; `--spacing-section` (64px) between themes.

The reading-column rule does NOT apply to the Editorial Room — that surface is data-dense and uses full-width layouts. See *Editorial Room density* below.

## Citations & blockquotes

Citations are central to Signal's voice. The pattern is **footer, not inline** — Editor's prose names authors as plain text ("Sam Altman," "Lenny Rachitsky," "Theo"), the way a publication writes; below each theme, a citation strip lists the cited tweets as `@handle` links. Inlining handles inside prose has been ruled out: it reads as engineering, not editorial.

**Per-theme citation footer** — the canonical citation surface on `/today`:

- Inter 400 caption (12px), `--color-gravel`. `--spacing-default` (24px) above the strip; no eyebrow, no "Citations:" lead-in.
- Handles joined by middle-dot (`·`); each in `--color-citation` underlined (`text-underline-offset: 2px`), linking to its cited tweet's URL.
- Source: `theme_citations` joined to `tweets`, ordered by `theme_citations.position` ascending, no role filter. Same-author repeats render as repeated handles — de-duping is an open question.

**Pull quote** — used sparingly, for the rare quote that carries thesis weight on its own:

- Fraunces 300 italic at body-lg (18px)
- Left rule: 2px solid `--color-chalk`, 16px left padding (the only "rule" in the system)
- Attribution below the quote: Inter 400 caption (12px), `--color-gravel`, prefix `— `, `@handle` underlined and colored `--color-citation` (the one place a `@handle` may appear *near* prose rather than in the per-theme footer).
- **No quotation marks rendered** — the typography carries the quote signal. Typed quotation marks duplicate what the rule and the italic already say.

```
  │ The harness is the competitive surface, not the model.
  │
  │ — @lennysan
```

## Components

Seven components, all that Signal needs.

### Primary pill button (filled)
Background `--color-obsidian`, text `--color-eggshell`, `--radius-pill`, padding `0 16px`, height driven by line-height. Inter 500 14px. Subscribe / Send digest. One per visual cluster.

### Ghost pill button (outline)
Background `--color-eggshell`, text `--color-obsidian`, `--radius-pill`, padding `0 12px`, border `1px solid --color-chalk`. Inter 500 14px. Secondary actions — "Read archive," "Open editorial room."

### Section eyebrow label
Inter 400 14px `--color-gravel`. Placed `--spacing-tight` (8px) above a Fraunces heading. Communicates category — "Theme 3," "Today's signal" — without visual decoration.

### Archive row
See *Archive list pattern* below.

### Score chip (Editorial Room only)
`--radius-pill`, padding `4px 8px`, Inter 500 12px, fill `--color-powder`, text `--color-obsidian`. **Color does not encode severity** — the number is the signal. A 4 and an 8 use the same chip; the contrast comes from the digit, the issue list beside it, and the reader's calibrated rubric. (UI mirrors the prompt's anti-safe-middle discipline.)

### Citation link
`@handle` rendered in `--color-citation` with `text-decoration: underline`, `text-underline-offset: 2px`. No hover background, no transition; the underline carries it. Used in the per-theme citation footer (the canonical case) and in pull-quote attributions. **Not used inline in body prose** — Editor names authors as plain text and the citation footer carries the links. See *Citations & blockquotes*.

### Diff rendering (Editorial Room)
Inline word-level diff between Writer and Editor drafts in the Drafts section. Removed text uses `--color-diff-removed` at Inter 700 with `text-decoration: line-through`; added text uses `--color-diff-added` at Inter 700 with `text-decoration: underline`, `text-underline-offset: 2px`; unchanged text in body color at the inherited weight. Saturated red/green is the right call here — the diff is the explicit code-review-style chromatic exception within an otherwise near-monochrome system. Computed server-side via `diff-match-patch` with `diff_cleanupSemantic` for word/phrase-level chunks rather than character noise.

## Archive list pattern

The archive index (and any future digest list) is a vertical list, no card chrome, no shadows. Pure typographic rows; the monospace date column is the visual anchor.

Each row:
- **Date** in JetBrains Mono 14px `--color-gravel`, fixed-width column ~120px
- **Theme titles** in Inter 500 16px `--color-obsidian`, joined by a middle-dot separator (`·`)
- **Dek** (optional, one line) in Inter 400 14px `--color-gravel`, below the titles
- **Row separator**: 1px `--color-chalk` between rows
- **Vertical padding**: `--spacing-default` (24px) per row

```
2026-04-30  Coding agents harness · Cyber capability · Musk v. Altman · Pipes
            All four themes are substantive. Polish on Theme 3 bold.

2026-04-29  AI infra Q1 · Open-source vibes · Anthropic compute crunch
            Single-storyline day. Anthropic crunch carried as own theme.
```

The `--color-chalk` rule between rows is the only horizontal element on the page. No alternating row fills, no hover backgrounds — the row that the reader's cursor is over is not visually distinguished. The page reads as a printed index.

## Editorial Room density note

`/editorial-room/[date]` is the transparency surface — it shows `agent_runs`, eval scores, raw input/output JSON. Different density rules from `/today`. The reading-column measure does NOT apply.

- **Body size**: 14px (caption-adjacent), line-height 1.5. Down from 18px on `/today`.
- **Code & JSON**: JetBrains Mono 13px, `--color-powder` fill, `--shadow-hairline`, `--radius-card`. Used for any model output dump or input payload.
- **Tabular rows**: `--spacing-tight` (8px) padding, `--color-chalk` row dividers. No striping.
- **Score chips**: as defined under *Components* — neutral fill, the digit carries the signal, no green/red severity color.
- **Layout**: full-width, side-by-side input/output panes are correct here. The 65ch reading-column rule is intentionally suspended.
- **Eyebrow labels**: scaled down to 12px `--color-gravel` to suit the denser ladder.

The view is dense by design. Two surfaces, two density modes — `/today` is for savoring, the Editorial Room is for scanning.

## Do's and Don'ts

### Do
- Use Fraunces 300 (light) for every heading and display — never reach for a heavier weight to "make it pop."
- Hold the rest of the palette near zero saturation. Chromatic ink is reserved for: `--color-citation` on `@handle` links, and `--color-diff-removed` / `--color-diff-added` on the Editorial Room diff. The diff tokens are saturated by design — they have to read as code-review color across paragraphs of unchanged prose; muted versions don't carry the load.
- Apply `--shadow-hairline` (inset 0.5px) to cards and code blocks instead of a literal border.
- Keep prose at the 65ch measure on `/today`. If it feels narrow on a wide monitor, that is the point.
- Use JetBrains Mono only where content is fixed-width by nature: dates, code, model output, machine annotations.
- Render `@handle` links as `--color-citation` underline, no hover background, no animation.

### Don't
- Don't introduce a fourth spacing bucket. If something doesn't fit `tight / default / section`, the component is wrong, not the system.
- Don't encode score severity with color in the Editorial Room. Neutral chip, the digit carries it.
- Don't apply `--shadow-float` to anything in the reading view. It is reserved for modals.
- Don't render quotation marks in pull quotes. The italic Fraunces and the left rule already say "quote."
- Don't add a hover background to archive rows. The list is a printed index.
- Don't use `--color-citation` (the blue) for anything other than `@handle` citation links — not for buttons, not for primary actions, not for emphasis. Don't use `--color-diff-removed` or `--color-diff-added` outside the Editorial Room diff.
- Don't auto-link author names ("Sam Altman," "Theo") inside body prose. Editor names people the way a publication does; the citation footer carries the links.
- Don't rename the `--spacing-*` tokens to `--space-*`. Tailwind v4 generates utility classes only from the `--spacing-*` namespace.

## Surfaces

| Level | Token | Value | Purpose |
|-------|-------|-------|---------|
| 0 | Page ground | `#fdfcfc` | Base for `/today`, archive, email |
| 1 | Powder | `#f5f3f1` | Hover row, code block fill, score chip fill |
| 2 | Card white | `#ffffff` | Rare — used only when a card needs to pop off eggshell (modal sheet, focused input) |
| 3 | Obsidian | `#000000` | CTA fill, the rare full-bleed dark surface |

### Elevation

Hairline only. `--shadow-hairline` is the default for any element that needs to read as a discrete surface; it is an inset 0.5px line, not a drop shadow. Elements detach from the eggshell ground rather than float above it. `--shadow-float` exists for modals; it should appear at most once per view.

## Quick Start — CSS Custom Properties

```css
:root {
  /* Colors */
  --color-eggshell: #fdfcfc;
  --color-powder:   #f5f3f1;
  --color-chalk:    #e5e5e5;
  --color-fog:      #b1b0b0;
  --color-slate:    #a59f97;
  --color-gravel:   #777169;
  --color-cinder:   #575347;
  --color-obsidian: #000000;
  --color-citation: #0447ff;
  --color-diff-removed: #cf222e;
  --color-diff-added:   #1a7f37;

  /* Typography */
  --font-serif: 'Fraunces', ui-serif, Georgia, 'Times New Roman', serif;
  --font-sans:  'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono:  'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --text-caption:   12px;  --leading-caption:   1.4;
  --text-body:      16px;  --leading-body:      1.6;
  --text-body-lg:   18px;  --leading-body-lg:   1.6;
  --text-heading:   24px;  --leading-heading:   1.3;  --tracking-heading: -0.01em;
  --text-display:   40px;  --leading-display:   1.1;  --tracking-display: -0.02em;

  --weight-light:   300;
  --weight-regular: 400;
  --weight-medium:  500;

  /* Spacing — three buckets */
  --spacing-tight:   8px;
  --spacing-default: 24px;
  --spacing-section: 64px;

  /* Border radius */
  --radius-input: 4px;
  --radius-card:  16px;
  --radius-pill:  9999px;

  /* Shadows — two variants */
  --shadow-hairline: rgba(0,0,0,0.075) 0 0 0 0.5px inset;
  --shadow-float:    rgba(0,0,0,0.4) 0 0 1px 0, rgba(0,0,0,0.04) 0 2px 4px 0;

  /* Reading measure */
  --measure-prose:   65ch;
  --measure-display: 80ch;
}
```

## Tailwind v4 — `@theme` block

```css
@theme {
  --color-eggshell: #fdfcfc;
  --color-powder:   #f5f3f1;
  --color-chalk:    #e5e5e5;
  --color-fog:      #b1b0b0;
  --color-slate:    #a59f97;
  --color-gravel:   #777169;
  --color-cinder:   #575347;
  --color-obsidian: #000000;
  --color-citation: #0447ff;
  --color-diff-removed: #cf222e;
  --color-diff-added:   #1a7f37;

  --font-serif: 'Fraunces', ui-serif, Georgia, serif;
  --font-sans:  'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono:  'JetBrains Mono', ui-monospace, monospace;

  --text-caption: 12px;
  --text-body:    16px;
  --text-body-lg: 18px;
  --text-heading: 24px;
  --text-display: 40px;

  --spacing-tight:   8px;
  --spacing-default: 24px;
  --spacing-section: 64px;

  --radius-input: 4px;
  --radius-card:  16px;
  --radius-pill:  9999px;

  --shadow-hairline: rgba(0,0,0,0.075) 0 0 0 0.5px inset;
  --shadow-float:    rgba(0,0,0,0.4) 0 0 1px 0, rgba(0,0,0,0.04) 0 2px 4px 0;
}
```
