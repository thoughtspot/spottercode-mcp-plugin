---
description: Move a Model copy that was made by TML export/import into a secondary Org onto ThoughtSpot Orgs Publishing — publish the governed Model into that Org, carry the copy's sharing, repoint the Answers built on the copy, and delete the copy. Phase 1 (v0) supports one Org and one Model whose copy matches the governed Model column for column.
---

# Migrate a TML Model copy to Orgs Publishing (v0)

Before Publishing, customers shared a Model with a secondary Org by exporting its TML from
the Primary Org and importing it there. This skill replaces that **copy** with the governed
Model, published into the Org, without breaking the content built on the copy.

Design and live-test record: `docs/migrate-tml-copies-design.md`,
`docs/migrate-tml-copies-test-scenarios.md` in this plugin's repository.

## Scope of v0 — refuse everything else

Supported, and tested end to end on a live cluster:

- one governed Model (Primary Org) and its copy in **one** secondary Org
- the copy matches the governed Model **column for column** (verdict `READY`); only the
  warehouse `schema` differs
- dependents on the copy are **Answers**
- the copy's sharing is object-level (users and groups)

**Stop and say "not supported in this version yet"** when any of these appear: renamed or
missing columns, a changed formula or join, a View on the copy, a Liveboard, a Set
(`COHORT`) dependent, content built directly on the copy's Tables, column-level sharing or
Column Security Rules on the copy, or a different database, table name or connection type.

## Requirements

- `execute-thoughtspot-code` with an **`org_identifier`** parameter. The browser sign-in
  always lands in the user's default Org, so without it the secondary Org is unreachable.
  If the tool has no `org_identifier`, stop and say so.
- The user is an administrator in the Primary Org **and** the secondary Org.
- Inputs: the governed Model's TML export (Primary Org), the copy's TML export (secondary
  Org) — both exported **with dependencies**, from the UI or REST — and the secondary Org's
  name.

## Rules for every step

- **GUIDs only.** The copy and the published Model share a name in the secondary Org, and a
  lookup by name returns `DUPLICATE_OBJECT_FOUND`.
- **Name the Org on every call.** A read in the wrong Org returns an empty list, not an error.
- **One write step per run, one approval per run.** Show the exact code before each write.
  Read the current state first and write only what is missing, so a re-run is safe.
- **Stop at the first failed check.** Every step leaves a state that works.
- Keep `migration/<org>/<model>/` locally: `inputs/` (both exports + checksums), `backup/`,
  and a `ledger.json` of every write with its before and after values.

## Steps

| # | Step | Org | Writes |
|---|---|---|---|
| 1 | Compare the two exports | — (local) | no |
| 2 | Live checks and dependents | secondary | no |
| 3b | Re-key the copy's `obj_id`s | secondary | yes |
| 3a | Variable for the schema | Primary | yes |
| 3c | Publish | Primary | yes |
| 3d | Verify the publish | secondary | no |
| 4 | Carry the copy's sharing | secondary | yes |
| 5 | Back up and repoint each Answer | secondary | yes |
| 6 | Verify | secondary | no |
| 7 | Delete the copy, its Tables and connection | secondary | yes |

3b runs before 3a so both secondary-Org steps come before the switch; it only has to
precede 3c.

### 1. Compare the two exports (local)

Unzip both. Each must hold one Model, its Table files and their Connection file, and every
file must parse. **Stop** if the two Model GUIDs are equal (both exports came from one Org).
Resolve each Model table through its `fqn` to a Table file.

Pair Tables by `db_table`, then compare:

- **Columns** — by physical binding (`<table>.<db_column_name>`), then name, `column_type`,
  `aggregation`. Formulas: resolve `[TABLE::column]` references and **normalise whitespace**
  before comparing (exports differ by trailing spaces).
- **Joins** — `on`, `type`, `cardinality`.
- **Tables** — only `schema` may differ. Record the copy's value per Table.
- **Connections** — by content, never name: `type`, non-secret properties (account, user,
  role, warehouse), `selected_databases`. Ignore secrets.
- **`obj_id`s** — list every copy object (Model, Tables, Connection) whose `obj_id` equals
  the governed one's. They all need re-keying.

Verdict `READY` only if everything matches except `schema`. Otherwise stop (out of scope).
Archive both zips unchanged in `inputs/` with SHA-256 checksums.

### 2. Live checks and dependents (secondary Org, read-only)

- Admin in both Orgs; the governed GUID exists in Primary; the copy's GUID exists in the
  secondary Org and is **not** a published object (`include_only_published_objects: true`
  returns nothing).
- Dependents of the copy: `metadata/search` on the copy's GUID with
  `include_dependent_objects: true`, `dependent_objects_record_size: -1`,
  `dependent_object_version: "V2"`. Answers arrive under `QUESTION_ANSWER_BOOK`. A string in
  `dependent_objects` means the lookup failed — stop. Any other dependent type → stop.
- The same lookup on each of the copy's Tables must return **only the copy**. Anything else
  is content built directly on a Table → stop.
- Per Answer: export its TML; the `[…]` tokens in `search_query` must all be copy columns.
- Sharing snapshot: `security/metadata/fetch-permissions` with `permission_type: "DEFINED"`
  on the copy and on each Answer.
- Data fingerprint per Answer: `metadata/answer/data`, rows sorted, SHA-256.

### 3b. Re-key the copy's `obj_id`s (secondary Org)

For each object in the Step 1 list, read its `obj_id` first and stop if it changed. Then
`metadata/update-obj-id` — identify by GUID, **not** also by `current_obj_id`:

```json
{ "metadata": [{ "metadata_identifier": "<copy guid>", "type": "LOGICAL_TABLE", "new_obj_id": "<old>__copy_<org>" }] }
```

The copy's Tables use `LOGICAL_TABLE`; its connection uses `DATA_SOURCE`, in a separate call.
Publishing brings the governed connection into the Org too (hidden from search), so the
connection clashes as well.

### 3a. Variable for the schema (Primary Org)

If the governed Tables already use a variable (`schema: ${…}` in their TML), only add this
Org's value. Otherwise, in this order:

1. `template/variables/create` — `{ "type": "TABLE_MAPPING", "name": "<name>" }`, **no
   `data_type`** (refused for this type).
   Name: `{connection}_{current Primary value}_{field}`, slugified, e.g.
   `primaryconn_primary_data_schema`. Tables sharing a value share the variable. Reuse is
   decided from the Tables' bindings and the variable's values, never from the name.
2. `template/variables/update-values` — `operation: "ADD"` only, never `REPLACE` or `RESET`.
   **Primary's value first** (the current literal), then the secondary Org's (the copy's
   schema), each with `variable_value_scope: [{ "org_identifier": "<org>" }]`.
3. `metadata/parameterize` per Table — `metadata_type: "LOGICAL_TABLE"`,
   `field_type: "ATTRIBUTE"`, `field_name: "schemaName"`.
4. Read back the values, and confirm Primary's data is unchanged.

If the secondary Org already has a different value → stop and ask.

### 3c. Publish (Primary Org)

`security/metadata/publish` — `{ "metadata": [{ "identifier": "<governed guid>", "type": "LOGICAL_TABLE" }], "org_identifiers": ["<org>"] }`.
Never `skip_validation`. The Tables and connection follow the Model.

### 3d. Verify the publish (secondary Org, read-only)

Query the published Model with `searchdata` and compare with the copy's numbers for the same
query. **Sage indexing lags the publish**: until it catches up, searches fail with 11020
*"Invalid data source guid"* (UI: Ref 10028). Retry every few minutes; if it never
succeeds, stop — "published, but not yet searchable in this Org". Never start Step 4
before the published Model returns the copy's numbers.

### 4. Carry the copy's sharing (secondary Org)

Re-read the copy's `DEFINED` sharing now. Grant each principal on the published **Tables
first**, then the **Model** (a grant on an object whose source is not shared can be silently
dropped):

```json
{ "metadata": [{ "type": "LOGICAL_TABLE", "identifier": "<guid>" }],
  "permissions": [{ "principal": { "type": "USER_GROUP", "identifier": "<principal guid>" }, "share_mode": "READ_ONLY" }],
  "message": "" }
```

`message` is required. `MODIFY` on the copy becomes `READ_ONLY` — say so. Never lower
access a principal already has. Read back: check `permission`, not `shared_permission`.

### 5. Back up and repoint each Answer (secondary Org)

Per Answer, two runs:

- **Backup (read)** — record `metadata_header.modified` as `t0`; export YAML
  (`export_fqn: true`); return it with its SHA-256 (in slices if over the output limit);
  save it to `backup/<guid>.answer.tml` and check the hash.
- **Repoint (write)** — stop if `modified` ≠ `t0`. Export again; replace the copy's GUID
  with the governed GUID in `tables[].fqn`; the copy's GUID must appear **0** times and the
  governed GUID once. `metadata/tml/import` with `import_policy: "VALIDATE_ONLY"`, then
  `"ALL_OR_NONE"`, `create_new: false`. Re-export: same GUID, new `fqn`. Read its data.

Rollback: re-import the backup over the same GUID.

### 6. Verify (secondary Org, read-only)

The copy has no dependents; each Answer depends on the published Model; each Answer's
fingerprint equals Step 2's; each Answer's sharing is unchanged. Then ask the user to open
an Answer as a **non-admin** member of a granted group and confirm the numbers.

### 7. Delete the copy (secondary Org)

Only after Step 6 passes and the user confirms. Re-check: zero dependents, the copy
unchanged since the archive, no new sharing. Then, each after an identity check (the copy's
GUID, not a published object, `obj_id` ending `__copy_<org>`):

1. the copy Model — `metadata/delete`
2. each copy Table, if it now has zero dependents — `metadata/delete`
3. the copy's connection, if no Table depends on it — `connections/{id}/delete`
   (restoring it later needs its credentials re-entered; say so first)

Confirm all are gone and the Answers still return their numbers.

## Rollback

| Stopped after | Undo |
|---|---|
| 1–2 | nothing written |
| 3b | `update-obj-id` back to the old values |
| 3a | unparameterize the Tables, delete the variable (if created) |
| 3c | `security/metadata/unpublish` from the Org — before Step 5 only |
| 4 | share `NO_ACCESS` for each principal added |
| 5 | re-import each backup |
| 7 | re-import the copy from `inputs/` with the re-keyed `obj_id`s, then the backups |
