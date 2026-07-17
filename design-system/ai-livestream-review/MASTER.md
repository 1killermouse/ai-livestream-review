# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** AI Livestream Review
**Generated:** 2026-07-15 21:08:26
**Category:** Productivity Tool
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 7/10 (Standard)

---

## Global Rules

### Color Palette

| Role        | Hex       | CSS Variable          |
| ----------- | --------- | --------------------- |
| Primary     | `#2563EB` | `--color-primary`     |
| On Primary  | `#FFFFFF` | `--color-on-primary`  |
| Secondary   | `#EEF2F7` | `--color-secondary`   |
| Accent/CTA  | `#DBEAFE` | `--color-accent`      |
| Background  | `#F7F8FB` | `--color-background`  |
| Foreground  | `#1D2535` | `--color-foreground`  |
| Muted       | `#F1F3F7` | `--color-muted`       |
| Border      | `#D8DDE6` | `--color-border`      |
| Destructive | `#DC2626` | `--color-destructive` |
| Success     | `#208A5B` | `--color-success`     |
| Warning     | `#DB7606` | `--color-warning`     |
| Ring        | `#2563EB` | `--color-ring`        |

**Color Notes:** Blue carries primary actions. Red, amber, and green are reserved for risk, attention, and success states.

### Typography

- **Heading Font:** System sans-serif / PingFang SC
- **Body Font:** System sans-serif / PingFang SC
- **Mood:** precise, calm, operational, customer-facing
- **Loading:** No external font request; keep Chinese rendering fast and stable.

### Spacing Variables

_Density: 7/10 — Standard_

| Token         | Value             | Usage                     |
| ------------- | ----------------- | ------------------------- |
| `--space-xs`  | `4px` / `0.25rem` | Tight gaps                |
| `--space-sm`  | `8px` / `0.5rem`  | Icon gaps, inline spacing |
| `--space-md`  | `16px` / `1rem`   | Standard padding          |
| `--space-lg`  | `24px` / `1.5rem` | Section padding           |
| `--space-xl`  | `32px` / `2rem`   | Large gaps                |
| `--space-2xl` | `48px` / `3rem`   | Section margins           |
| `--space-3xl` | `64px` / `4rem`   | Hero padding              |

### Shadow Depths

| Level         | Value                          | Usage                       |
| ------------- | ------------------------------ | --------------------------- |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`   | Subtle lift                 |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)`    | Cards, buttons              |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)`  | Modals, dropdowns           |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #2563eb;
  color: white;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1d4ed8;
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1d2535;
  border: 1px solid #d8dde6;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #ffffff;
  border: 1px solid #d8dde6;
  border-radius: 8px;
  padding: 24px;
  box-shadow: var(--shadow-sm);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  border-color: #bfdbfe;
}
```

### Data Bands

- Group related summary metrics into one bordered band with internal dividers.
- Use separate cards only when each item opens a distinct workflow or needs independent interaction.
- Passive badges do not animate on hover.

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #2563eb;
  outline: none;
  box-shadow: 0 0 0 3px #2563eb20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Light Operational Dashboard

**Keywords:** light, compact, task-first, data clear, restrained, trustworthy, professional

**Best For:** Livestream operations, compliance review, analysis reports, repeated daily work

**Key Effects:** Subtle borders and shadows, 150-200ms state transitions, stable layout bounds, no decorative animation.

### Page Pattern

**Pattern Name:** Task-first Workspace

- **Workflow Strategy:** Put recording/upload first, keep analysis framework secondary, and preserve one primary CTA per state.
- **CTA Placement:** Beside the current input or at the end of its state transition.
- **Section Order:** 1. Source selection, 2. Recording/upload, 3. Analysis progress, 4. Report navigation, 5. Actionable output.

---

## Motion

Use 150-200ms color, border, opacity, and shadow transitions. Respect `prefers-reduced-motion`; do not hide important content behind entrance animation.

---

## Anti-Patterns (Do NOT Use)

- ❌ Complex onboarding
- ❌ Marketing-style hero sections
- ❌ Dark cinematic styling for operational pages
- ❌ Nested cards and decorative gradients
- ❌ Low-contrast explanatory copy

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
