# Ops Page Overrides

> **PROJECT:** Hatchway
> **Generated:** 2026-09-24 13:42:38
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- Preserve the live Hatchway storefront palette for continuity:
  - Ink `#10143A`
  - Night `#17124F`
  - Cobalt `#3847E7`
  - Ice `#BDEFFF`
  - Paper `#F8F7F2`
  - Coral `#FF715B`
  - Butter `#FFDC67`

### Component Overrides

- Avoid: Leave UI frozen with no feedback
- Avoid: Make dragging the only way to reorder resize or select
- Use ruled manifest rows and lane dividers instead of a generic floating-card dashboard.
- Status changes must show loading, success, and recoverable error feedback.

---

## Page-Specific Components

- Three-lane fulfillment route board
- Dense operations manifest with persistent order status controls
- Inventory ledger with deliberate restock actions

---

## Recommendations

- Effects: Hover tooltips, chart zoom on click, row highlighting on hover, smooth filter animations, data loading spinners
- Animation: Use skeleton screens or spinners
- Accessibility: Add buttons menus or tap-to-move controls and retain keyboard operation
