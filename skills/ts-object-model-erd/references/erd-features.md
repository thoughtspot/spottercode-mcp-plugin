# ERD Features

What the generated HTML can do. The viewer is `assets/renderer.js` and
`assets/renderer.css`, inlined into the page, so the file works offline and needs no
ThoughtSpot login.

- **Layouts:** Organic, Star, Layered →, Layered ↓. The layered layouts cluster joined
  tables (Sugiyama median crossing-reduction).
- **Notations:** Arrow (ThoughtSpot style) and Crow's foot (cardinality).
- **Column modes:** Collapsed, Join keys, Flagged only, All columns.
- **Focus mode:** click a table to highlight its neighbourhood; shift-click to compare
  tables and trace the join path; double-click for the full connected component.
- **RLS overlay:** secured tables show a red border and 🔒; tables referenced in another
  table's rule are amber (in RLS path).
- **Findings overlay:** toggle structural findings.
- **Drag to reposition:** positions auto-save in the browser's localStorage, per Model
  and layout. **⟲ Reset** restores the auto-layout.
- **Multi-Model switcher** when several Models are in one file.
- **Navigation:** drag or scroll to pan; pinch or ⌘-scroll (Ctrl-scroll on Windows) to
  zoom; arrow keys pan, `+`/`-` zoom, `0` fits (to the focused neighbourhood if a table is
  focused, otherwise the whole Model). Built for large Models (verified on a 79-table
  export) where the default fit would otherwise be microscopic.
- **Minimap:** an always-on overview in the bottom-right corner with a viewport
  rectangle. Click or drag it to jump anywhere. Collapsible, and the state persists.
- **Search** zooms to a readable level instead of leaving a microscopic fit scale.
- **Semantic zoom:** below 0.5× zoom, tables render as bold, colour-coded overview blocks
  (solid fill by kind, crisp non-scaling border, centred title) instead of full column
  cards, so a large Model's fit view still reads as distinct regions. Borders never scale
  away. Full cards return above the threshold. State borders (secured, RLS, severity,
  focus), click-to-focus, drag and the minimap work at either scale.
- **Notes:** attach a free-text note to any table or join from its inspector panel. Save
  and Delete give immediate feedback ("Saved ✓" / "Note deleted"). The **Notes** filter
  chip highlights every noted object, including at overview zoom, and is disabled when
  there are no notes. **Review notes** lists every note (table, join, or "not in model"
  for a note whose object was renamed since); click a row to jump to it, or remove it
  inline.
- **Group by (subject areas):** colours tables into subject areas with one of three
  strategies:
    - **Name prefix**: source-system naming, such as `SFDC_*` or `MIXPANEL_*`
    - **Graph cluster**: community detection on the join graph, for Models whose names are
      messy but whose joins reflect domains
    - **Fact neighbourhood**: each fact plus its nearest dimensions

    A group shows as a coloured stripe on each node (and tints the overview block), with
    a legend; click a legend row to highlight one group. Grouping only recolours. It
    never changes the layout.

- **Share HTML:** downloads a copy with the current positions and notes baked in, so the
  recipient sees the same view on first load.
- **Help (`?`):** legend, join badges (**M** model-local, **T** table-level) and every
  shortcut.
