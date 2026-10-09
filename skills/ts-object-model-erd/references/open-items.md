# Open Items — Unverified Behaviour

New with the move from the `ts` CLI to REST API v2 and JSON TML. None has been tested
against a live instance yet. The builder itself is verified against the Python original
(see [changelog.md](changelog.md)); these items are about the API and the TML it returns.

## 1. Model lookup by LOGICAL_TABLE + WORKSHEET subtype — UNVERIFIED

Step 2b searches type `LOGICAL_TABLE` with the subtypes filter set to `WORKSHEET` and
labels results `[MODEL]`/`[WORKSHEET]` from `contentUpgradeId`/`worksheetVersion`, as
ts-object-answer-promote does (its open item 7). The CLI original listed
`--subtype ONE_TO_ONE_LOGICAL`, which is the physical Table subtype, so it listed Tables,
not Models. That looks like a bug in the original; its intent was to list Models.

Confirm against REST v2 that:

- the subtypes field name and value are right, and exclude Tables and Views
- Models (not only legacy Worksheets) come back under `WORKSHEET`, or whether a `MODEL`
  subtype exists and should be added
- both header fields are present

The export in Step 3 stays authoritative: only a top-level `model` key is drawn.

[Record result here]

## 2. JSON edoc with export_associated — UNVERIFIED

Step 3 exports with `edoc_format: "JSON"` and `export_associated: true`. Confirm that:

- every element's `edoc`, including the associated Tables, comes back as a JSON string
  (not YAML) when JSON is requested
- the keys match the YAML export (`guid` at the root; `model_tables[].fqn`,
  `joins[].referencing_join`, `columns[].properties`)
- the join condition key is `on` in JSON (YAML quotes it as `'on'`; the parser accepts
  both)

If any element comes back as YAML, the builder skips it with a log line, and the ERD
loses that object's detail.

[Record result here]

## 3. Associated Table TMLs carry joins_with and rls_rules — UNVERIFIED

Join cardinality, type, origin, join keys and RLS all come from the associated Table
TMLs. Confirm that `export_associated` returns a `table` element for every
`model_tables[]` entry, with `joins_with` and `rls_rules`, and that `rls_rules` comes
back in a shape the parser handles (a flat list, or `{rules: [...]}`). Also check what a
user without access to a Table gets for it: a missing element, or one with status
`ERROR`. Either way the builder logs degraded fidelity for that table's joins.

[Record result here]

## 4. Large exports through the tool response — UNVERIFIED

The agent receives the export response from `execute-thoughtspot-code` and writes it to
a file. A large Model (the CLI original was checked on 79 tables) with full associated
TML may be several MB. Confirm the tool returns it whole, and that the agent can write it
verbatim. If it's truncated, fall back to exporting the Model and its Tables in smaller
batches (Model first, then Table GUIDs from `model_tables[].fqn`, a few per call) into
separate files; the builder joins them up by GUID.

[Record result here]

## 5. Known parser limits carried over from the original — DEFERRED

Kept for parity with ts-object-model-erd 1.7.1, not fixed in this port. Fixing them is
future work, with matching tests:

- The builder routes only `model` and `table` TML. `sql_view` objects in an export are
  ignored, so SQL-view nodes aren't marked or given their query.
- "In RLS path" is detected from `[TABLE::col]` references in rule expressions. Rules
  written against `table_paths` aliases (`[T_1::COL]`) don't mark other tables.
- Legacy Worksheets (`worksheet` TML) can't be drawn.
