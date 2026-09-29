# Design: migrate TML Model copies to Orgs Publishing

Status: **Draft — all steps designed.** Open questions are answered by testing on a live
cluster before each step is coded.
Skill: [`skills/migrate-tml-copies-to-publishing`](../skills/migrate-tml-copies-to-publishing/SKILL.md)

## Context

Before Orgs Publishing, customers shared a Model with other Orgs by exporting its TML from
the Primary Org and importing it into each secondary Org. Each secondary Org now holds its
own **copy**, with its own Answers and Liveboards built on it.

The goal is to move each copy onto the publishing flow: publish the governed Model from the
Primary Org into the secondary Org, repoint the content built on the copy at the published
Model, carry over the copy's permissions, and then **delete the copy**.

**The rollback is the TML files**, not the copy: the copy's export (input 3) restores the
copy, and each dependent's pre-repoint export restores that dependent. Because the copy is
deleted, those files are the only way back, so they are validated and archived before
anything is written.

**Phase 1 scope: Models only.** Answers and Liveboards are handled only as dependents to be
repointed, not as objects to publish.

**Steps**

| Step | What | Writes? |
|---|---|---|
| 1 | Validate and compare the two TMLs | no (offline) |
| 2 | Live check and dependents | no |
| 3 | Publish the governed Model into the secondary Org | yes |
| 4 | Give the published Model the copy's permissions | yes |
| 5 | Repoint dependents | yes |
| 6 | Verify | no |
| 7 | Delete the copy | yes |

## Summary and build order

**What the skill does.** Given the governed Model's TML (Primary Org), the copy's TML and
the secondary Org's name, it proves the governed Model can stand in for the copy, publishes
it into the secondary Org, gives it the copy's permissions, repoints everything built on
the copy, verifies, and deletes the copy. The TML files, the sharing snapshots and the
ledger are the rollback.

**How it runs.** Step 1 is local. Every cluster call goes through spotter-code's
`execute-thoughtspot-code` with `org_identifier` (the `org-aware-code-exec` branch is a
hard dependency). Reads run freely; each write is a separate run behind its own approval.
State between runs lives in `migration/<secondary org>/<copy name>/plan.json`.

**Found live — sign-in always lands in the default Org.** The spotter-code OAuth sign-in
fetches its token with `callosum/v1/v2/auth/token/fetch` and no `org_identifier`, so the
token is scoped to the user's **default** Org whatever Org the browser is in. A multi-Org
admin can therefore never reach a secondary Org through the production tool:
`org_identifier` is a hard requirement, not a convenience. The sign-in also depends on
the cluster's IAM login (`callosum/v1/saml/login`) and fails on a cluster with IAMv2
disabled. For testing only, the server's `/bearer/mcp` route accepts a ThoughtSpot token
per Org (`Authorization: Bearer <token>`, `x-ts-host: <cluster>`), obtained with
`auth/token/full` and `org_id`.

**Live vs downtime.** Steps 1–3 run live. Steps 4–7 run in a downtime window; how it is
enforced for one Org is still open (Q18).

**What ships in the skill** (`skills/migrate-tml-copies-to-publishing/`):

| File | Used by | Runs |
|---|---|---|
| `SKILL.md` | the agent | — (the procedure; rewritten from this design) |
| `scripts/fingerprint.mjs` | Steps 1, 2a, 7a | locally **and** in the sandbox — one function, both places |
| `scripts/compare.mjs` | Step 1 | locally (Node; `yaml` package pinned) |
| `scripts/dependents.js` | Steps 2, 6a, 7a | sandbox, read-only |
| `scripts/publish.js` | Step 3 (3a / 3b / 3c as separate modes) | sandbox, write |
| `scripts/grants.js` | Steps 4, 6c, 7a | sandbox, read + write |
| `scripts/repoint.js` | Step 5 (backup / rewrite+import modes) | sandbox, read + write |
| `scripts/verify.js` | Step 6 | sandbox, read-only |
| `scripts/delete.js` | Step 7 | sandbox, write |

**Build order** — read-only first, and each step only after its open questions are answered
on a live cluster:

1. `fingerprint.mjs` + `compare.mjs` (Step 1) — offline, testable with any two exports.
2. `dependents.js` (Step 2) — first cluster use, read-only.
3. `publish.js` (Step 3).
4. `grants.js` (Step 4).
5. `repoint.js` (Step 5) — the largest; port the rules and tests from `ts-migrate-orgs`
   `rewrite.py`.
6. `verify.js` (Step 6).
7. `delete.js` (Step 7).
8. Rewrite `SKILL.md` around the finished scripts.

## Running the migration — downtime (to be decided)

Steps 1–3 run live: none of them changes what secondary-Org users see or use. Steps 4–7
change the objects users work with, and **run in a downtime window** — relying on users not
to edit during a live run was rejected.

How downtime is enforced for one Org is open, and is settled by testing on a live cluster.
Options considered, from the REST spec:

| Option | Per Org? | Status |
|---|---|---|
| Set the Org inactive | — | No endpoint sets it (`orgs/search` only filters on `IN_ACTIVE`) |
| `users/deactivate` | No, cluster-wide | Rejected: reactivation needs a token and a new password per user |
| `orgs/update` `REMOVE` users from the Org | Yes | Likely drops their group memberships and content in the Org — untested |
| `NO_ACCESS` on the copy and its dependents | Yes | Authors and admins keep access; two extra writes per object |
| **Customer blocks access outside ThoughtSpot** (embedded app stops issuing tokens / SSO route off), then the skill ends open sessions with `users/force-logout` on an explicit user list | Yes | **Proposed.** Never call `force-logout` with an empty list — that logs out every user on the cluster |

Whatever the mechanism, these checks run in Steps 4–7 and **stop the run** if they fire,
because a hit means the downtime leaked:

1. **At the start of Steps 4–7** — re-run the dependent lookup (2b), the copy's sharing, and
   the copy file check (2a), and take the "before" data fingerprints (6b). Phase 1 may be
   days old, and fingerprints must be as close to the repoint as possible.
2. **Per object in Step 5** — record the last-modified time at backup; re-read it just
   before import. Different means the object was edited after its backup.
3. **Before Step 7** — the copy must have zero dependents, and any share added to the copy
   since Step 4 is applied to the published Model first.

## Step 1 — Validate and compare the two TMLs

Offline. Reads two files, writes only a local plan file. No cluster access.

### Inputs

The customer provides:

| # | Input | Used for |
|---|---|---|
| 1 | Governed Model TML export, from the Primary Org | Comparison; gives the governed GUID and `obj_id` |
| 2 | Secondary Org name | Recorded in the plan; first used in Step 2 |
| 3 | Copy Model TML export, from the secondary Org | Comparison; gives the copy GUID and `obj_id` |

Both exports must be taken **with dependencies** (the Model plus its Tables), so each Model
column can be traced to a physical warehouse column.

**Why TML files rather than exporting from the cluster.** `execute-thoughtspot-code` runs
in one Org per call and returns at most 24,000 characters (`DEFAULT_OUTPUT_MAX_CHARS` in
spotter-code `src/common/code-exec/consts.ts`, overridable by `CODE_EXEC_OUTPUT_MAX_CHARS`).
A Model export with its Tables often exceeds that, and the two sides live in different Orgs,
so they cannot be compared in one run. Local files have no such limit.

### 1a. Validate the inputs

Each check stops Step 1 on failure. None is downgraded to a warning, because each failure
leads to a comparison that looks clean but is wrong.

| Check | Why | On failure |
|---|---|---|
| Every file in each export parses | A skipped file silently drops a Table from the comparison | Stop and name the file. Never filter files by name to get past it |
| Each export contains exactly one Model, its Table files, and the Connection file of every Table | Without Table TML there are no physical bindings to compare; without Connection TML there is no way to tell whether the published connection can reach the copy's data | Stop; ask for a re-export with dependencies (`export_associated: true`) — a UI export with dependencies includes both |
| The two Model GUIDs differ | Equal GUIDs mean both exports came from the same Org, which compares perfectly clean | Stop |
| Every Model table resolves to exactly one Table file (rules below) | A wrong match binds columns to the wrong physical table | Stop; ask for a re-export with FQNs (`export_fqn: true`) |
| Every Table file in the export is used by the Model | An unused file suggests the wrong or a mixed export | Stop and name the file |

**Resolving a Model's tables to the Table files in its own export**

| Model table reference | Action |
|---|---|
| Has `fqn` (GUID) | Match to the Table file with that GUID. Preferred |
| No `fqn`; the name matches exactly one Table file in the export | Match by name; note it in the report |
| No `fqn`; the name matches several files, or none | Stop; ask for a re-export with FQNs |

A name is used only when it is provably unique **within the export**. The export holds only
this Model's own Tables, so uniqueness there is checkable; uniqueness across the cluster is
never assumed.

### 1b. Build a fingerprint of each side

Both sides are reduced by the same function, so they are always compared like for like.

```
connections: key → { name, type, properties (non-secret only), selected_databases }
tables:  key → { db, schema, db_table, connection, variables,
                 columns: { db_column_name → data_type },
                 rls_rules }
model:   columns: [{ name, binding, formula, aggregation, column_type }]
         joins:   [{ left, right, on, type, cardinality }]
         filters, parameters
```

- `binding` is `<table key>.<db_column_name>` for a column on a Table; empty for a formula.
- `formula` has its column references rewritten to bindings, so two formulas that read the
  same warehouse columns under different column names compare equal. References take the
  form `[TABLE::column]`, where `column` is the Table's column **name** — resolve it to
  `db_column_name` through the Table TML. Whitespace is normalised before comparing:
  found live, the same formula exported as `'… [SALES_FACT::COST] '` on one side and
  without the trailing space on the other.
- `cardinality` is normalised to one direction. The same join reads `ONE_TO_MANY` or
  `MANY_TO_ONE` depending on which side it is written under.
- `db`, `schema` and `db_table` are kept **raw** as well as resolved. A parameterized
  field reads `${variable_name}` in TML; `variables` records which field carries which
  variable. This tells Step 3 offline whether the governed Tables are already
  parameterized (case A) or not (case B).
- **Connections are compared by content, never by name.** After the migration the Org
  reads through the **published** connection, so what matters is whether it can reach the
  data the copy's connection reached: its `type` and non-secret `properties`
  (`accountName`, `warehouse`, `role`, `user`, …) and `selected_databases`.
- **Secrets are never read, compared or stored.** Exports blank them (`password: ""`); any
  property that is secret is dropped from the fingerprint.

### 1c. Pair the Tables across the two exports

GUIDs do not help here — the copy's Tables have their own GUIDs. Names do not decide it
either.

1. Pair on `db_table`.
2. Otherwise pair on the Table whose `db_column_name` set overlaps most. Report the overlap
   for every pair; below 1.0 is flagged for review.
3. **Stop** when two candidates tie, or when the same physical Table appears more than once
   in a Model (role-playing dimensions such as order date and ship date on one calendar
   table). Column sets cannot tell those slots apart; ask rather than pick.

### 1d. Compare

**Tables**

| Difference | Meaning |
|---|---|
| `db`, `schema` or `db_table` | Expected. Becomes the secondary Org's value for the publishing variable |
| Connection name | Informational. The copy's connection is not used after the migration |
| Connection type | Blocker. The published connection cannot reach data on another platform |
| Connection properties (account, warehouse, role, user) | Finding. The published connection reads with the Primary Org's settings unless the Org gets `CONNECTION_PROPERTY` values (3a); the customer chooses which |
| `selected_databases` lacks the copy's `db` | Blocker. The published connection cannot see the copy's database |
| RLS rules | Security finding. After the repoint the Org gets the governed Model's rules |

The `db` / `schema` / `db_table` values are where the copy's data lives. With identical
connection type and properties, the published connection reaches them for this Org —
decided here, offline. What TML cannot show is whether the connection's role has been
granted the copy's schema in the warehouse; Step 3d confirms it on the cluster by reading
through the published Model.

**Columns** — matched on binding (formulas on normalised formula), never on name

| Class | Rule | Effect |
|---|---|---|
| `MATCHED` | Same binding, same name | None |
| `RENAMED` | Same binding, different name | Entry in the column map, `copy name → governed name` |
| `MISSING` | In the copy, not in the governed Model | Blocker if content uses it |
| `CHANGED` | Same binding or name; different formula, aggregation or type | Blocker if content uses it |
| `EXTRA` | In the governed Model only | Informational |

Where two different columns bind the same warehouse column, binding alone cannot tell them
apart: fall back to name and formula, and report both candidates rather than choosing.

**Model** — any difference in joins (after normalising cardinality), filters or parameters
is a finding.

### Output

A report for the customer, and `migration/<secondary org>/<copy name>/plan.json`:

```json
{
  "secondary_org": "ACME",
  "governed": { "guid": "…", "name": "Sales", "obj_id": "sales_model" },
  "copy":     { "guid": "…", "name": "Sales", "obj_id": "sales_model" },
  "table_pairs": [{ "governed": "…", "copy": "…", "overlap": 1.0 }],
  "verdict_provisional": "RENAME",
  "column_map": { "Segment": "STRING_1" },
  "org_values": { "schema": "ACME_PROD" },
  "findings": [],
  "needs_rekey": true
}
```

| Verdict | Meaning |
|---|---|
| `READY` | Corresponds cleanly; identity column map |
| `RENAME` | Corresponds cleanly; names differ, so content must be rewritten |
| `BLOCKED` | A difference no mapping can fix |

The verdict is **provisional**: `MISSING` and `CHANGED` block only if content uses those
columns, which Step 2 determines from the copy's dependents.

`needs_rekey` lists **every** copy object whose `obj_id` equals the governed counterpart's —
the Model, its Tables and its Connection. Found live: a TML import carries all of them
over (`SALES_FACT-40639b92`, `PRODUCT_DIM-9f6ea9ff`, `PRIMARYconn-deaca893`), not only the
Model's. Publishing puts both in one Org with one `obj_id`, which is refused.

### Archive the inputs

The copy's export is the rollback for the copy, so Step 1 copies both exports unchanged
into `migration/<secondary org>/<copy name>/inputs/` and records a checksum of each in
`plan.json`. Later steps restore from this archive, never from wherever the customer
originally put the files. The validation in 1a doubles as the check that the rollback is
complete: an export missing Tables or with an unparseable file would also fail to restore.

### What Step 1 cannot see

- **Sets.** A Set is not in TML. Step 2 finds them in the copy's dependents.
- **Sharing and column security.** Not in TML. Handled in a later step.
- **Whether the exports are current.** Step 2's first call checks the files against the live
  objects.

### Implementation

A fixed script shipped with the skill, `scripts/compare.mjs`, run with Node. The agent runs
it; it does not reason through the comparison itself, so the same inputs always give the
same result.

### Open questions — Step 1

1. **Parsing YAML.** UI exports are zips of YAML. Proposed: pin the `yaml` npm package in
   `scripts/package.json`. Alternatives: require JSON exports (REST, `edoc_format: JSON`),
   or a hand-written parser (rejected — formulas and descriptions break naive parsers).
2. **Does a UI export include `fqn` on Model tables by default?** If not, the name fallback
   in 1a is the common path, not the exception.
3. **Formula normalisation.** Confirm which reference forms appear in Model formulas
   (`[Column]`, `[TABLE::column]`, …) so all of them are rewritten to bindings.
4. **Restoring a deleted copy.** Does re-importing the copy's TML after deletion recreate
   it with the **same GUID**? If it gets a new GUID, restored dependents must be repointed
   at it, and the rollback becomes a rewrite rather than a plain re-import.
5. **What restoring cannot bring back.** TML carries no sharing, and Sets are not in TML.
   The copy's permissions must be snapshotted before deletion (later step), and a copy
   carrying a Set is blocked in Step 2 anyway.
6. ~~**The copy's Tables.**~~ **Decided:** deleted after the copy Model, each only if it then
   has zero dependents; a Table still in use is kept and reported.
7. ~~**Is the connection published with the Model?**~~ **Answered live:** publishing the
   Model also publishes its Tables and connection. The connection is published but not
   returned by `metadata/search` in the secondary Org, so a check for it must not rely on
   that search.
8. ~~**The copy's connection after deletion.**~~ **Decided:** deleted last, after the copy's
   Tables, only if no Table depends on it (so it survives until the last copy Model in the Org
   is migrated), with the same identity check. Use `connections/{id}/delete` —
   `metadata/delete` has no connection type. Restoring it needs the credentials re-entered;
   the report says so before approval.

## Step 2 — Live check and dependents

The first step that uses the cluster, through `execute-thoughtspot-code` with
`org_identifier`. **Read-only**: every endpoint it calls is on the code-exec read allowlist
(`READ_OPERATIONS` in spotter-code `src/common/code-exec/security/policy.ts`), so no write
confirmation is ever requested and the step can be re-run freely.

**Goal:** find everything that depends on the copy, decide what blocks, and turn Step 1's
provisional verdict into a final one. The copy is deleted at the end, so anything left
pointing at it would break — the dependent list must be complete, not approximately right.

### 2a. Live checks

| Check | Org | On failure |
|---|---|---|
| Session user is an administrator | Primary and secondary | Stop. Without it, reads return empty lists rather than errors, so "no dependents" would be silently wrong |
| Governed GUID exists and is a Model | Primary | Stop |
| Copy GUID exists, is a Model, and is **not** a published object | secondary | Stop |
| The files match the live objects: export the copy (JSON) in the sandbox, fingerprint it with Step 1's function, compare its hash with `plan.json` | secondary | Stop; ask for a fresh export. A stale file is also a stale rollback |

The last check requires Step 1's fingerprint function to be plain JS that runs both
locally and in the sandbox — one function, used in both places.

### 2b. Find the dependents

```json
POST /api/rest/2.0/metadata/search
{ "metadata": [{ "type": "LOGICAL_TABLE", "identifier": "<copy guid>" }],
  "include_dependent_objects": true,
  "dependent_objects_record_size": -1,
  "dependent_object_version": "V2" }
```

- `dependent_objects_record_size: -1` is required; the default truncates the list silently.
- If `dependent_objects` comes back as a **string** (with HTTP 200), the lookup failed.
  Treat it as unknown and stop, never as "none".
- **Follow through Views.** A single lookup is one level deep: 200 Answers on 4 Views
  appear as 4 dependents. Repeat the lookup on each View found (depth cap 4, skip GUIDs
  already seen) and tag each object with `via_view`. That content needs no rewrite, but it
  is what breaks if a View is repointed wrongly, so the report must show it.
- Run the same lookup on each of the **copy's Tables**. Content built directly on them is
  not moved by repointing the Model.

| Dependent | Phase 1 action |
|---|---|
| `ANSWER`, `LIVEBOARD` directly on the copy | Repoint (later step). A hidden visualization Answer belonging to a Liveboard is repointed through its Liveboard and listed once |
| View (`LOGICAL_TABLE`, subtype `AGGR_WORKSHEET`) directly on the copy | Repoint, **keeping the column names it exposes** (later step) |
| Anything reached through a View (`via_view` set), including stacked Views | No rewrite: the View it sits on keeps exposing the same names. Listed for visibility |
| `COHORT` (Set) | **Blocker, no override.** For each Set, look up its own GUID as `LOGICAL_COLUMN` to list the content that reads it |
| Content directly on the copy's Tables | Reported, not migrated. See Q6 |
| Any other type | Reported; **blocks deletion of the copy**, not the migration |

A SQL View (`SQL_VIEW`) is built on a connection, not on a Model, so it never appears as a
dependent of the copy.

### 2c. Which copy columns content actually uses

Export the dependents that read the copy directly (Answers, Liveboards, Views) with one
batch `metadata/tml/export` call — up to about 40 per run to stay under the 50-call limit,
split beyond that. The full TML stays in the sandbox; only a compact row comes back:

```
{ guid, name, type, uses: ["Segment", "Revenue", …], tml_chars: 48210 }
```

- **Answers and Liveboards:** `uses` comes from the `[...]` tokens in each `search_query`
  plus formula expressions, counting only visualizations whose `tables[]` point at the
  copy. Names of the object's own formulas are excluded.
- **Views:** `uses` comes from the View's own `search_query` and
  `view_columns[].search_output_column` — what it reads, not what it exposes.
- Content reached through a View is not scanned; it reads the View's names, which do not
  change.
- `tml_chars` sizes the backup the repoint step must take (the 24k return limit applies
  there).

### 2d. The final verdict

| Step 1 class | Used by a dependent | Not used |
|---|---|---|
| `MISSING` / `CHANGED` | **BLOCKED**, naming the dependents that use it | Warning: it disappears with the copy |
| `RENAMED` | That dependent needs a column rewrite | No effect |
| `MATCHED` | Only the Model reference changes | — |

Report the effort, which is not the object count:

```
23 dependents: 5 need column rewrites, 3 need only the Model reference swapped,
15 sit on 2 Views and need nothing. 0 blocked.
```

### 2e. Record the current state

Read-only, and needed before anything is written:

- **The copy's sharing** — `security/metadata/fetch-permissions` on the copy (and its
  Tables, if Q6 says they are deleted). TML carries no sharing and the copy will be
  deleted, so this is the only record of who could access it. A later step re-applies it
  to the published Model.
- **The dependents' sharing** — to verify later that it survived the repoint. They keep
  their GUIDs, but that is to be confirmed.
- **Data fingerprints are not taken here.** They are taken at the start of the downtime
  window (see 6b), so warehouse data has as little time as possible to change before the
  repoint.

### Output

Added to `plan.json`:

```json
"live_check": { "copy_matches_export": true, "admin_primary": true, "admin_secondary": true },
"dependents": [{ "guid": "…", "type": "ANSWER", "name": "…", "via_view": null,
                 "uses": [], "needs_rewrite": true, "tml_chars": 0 }],
"views": [], "table_dependents": [], "sets": [], "unsupported": [],
"verdict": "RENAME", "blockers": [],
"sharing_snapshot": { "copy": [], "dependents": {} },
"data_fingerprints": {}
```

### Runs

| # | Org | Does |
|---|---|---|
| 1 | Primary | Administrator check; governed Model check |
| 2 | secondary | Administrator check; copy check; file-match check; dependents of the copy, through Views, and of its Tables |
| 3…n | secondary | Batch export of direct dependents (~40 per run); usage extraction |
| n+1 | secondary | Content reading each Set — only when a Set was found |
| n+2 | secondary | Sharing snapshot |

### Open questions — Step 2

9. **Data fingerprints** — take them in Phase 1 (see 6b), or verify only that each object
   resolves to the published Model?
10. **Dependent lookup through a View** — confirm `metadata/search` on a View's GUID
   returns its dependents the same way as on a Model.
11. **Hidden visualization Answers** — confirm how V2 dependents report Answers embedded in
   a Liveboard, so they collapse to the owning Liveboard.
12. **Admin check** — confirm which field of `auth/session/user` shows administrator
   privilege in an Org-scoped session.

## Step 3 — Publish the governed Model into the secondary Org

The first step that writes. Request shapes below are from the REST spec shipped with
spotter-code (`src/common/rest-api-sdk-resolved-spec.json`).

**Preconditions:** Step 2's verdict is not `BLOCKED`, and the customer has approved the
Step 1–2 report, including the column map, the findings, and the variable names proposed
below.

**One sub-step, one run, one approval.** 3a, 3b and 3c each run as a separate
`execute-thoughtspot-code` call and are never combined, so a write approval
(`confirm_write_operations: true`) covers exactly one change, shown to the customer
beforehand. Each run reads the current state first and writes only what is missing, so a
re-run after a partial failure skips what is done, and a completed sub-step makes no write
and needs no approval.

### 3a. Variables — point the published Tables at the copy's data (Primary Org)

Publishing is refused unless something in the Model's dependency tree is parameterized.
More importantly, the variable values decide **what data the secondary Org reads**. The
target values are Step 1's `org_values`: the copy's `db` / `schema` / `db_table`.

Step 1's fingerprint already shows which case applies; `template/variables/search` (read)
confirms it and reads the current values.

| Case | Action |
|---|---|
| **A** — the governed Tables are already parameterized (usual when the Model is published to other Orgs) | Add only this Org's value: `template/variables/update-values`, `operation: ADD`, scoped to `org_identifier: <secondary org>` |
| **A′** — this Org already has a value, and it differs from the copy's | **Stop and ask.** Someone configured it differently; overwriting would move the Org to other data |
| **B** — not parameterized | In this order: `template/variables/create` (`TABLE_MAPPING`, **no `data_type`** — refused for this type) → ADD the **Primary Org's value = the current literal** → ADD the secondary Org's value → `metadata/parameterize` each field |

```json
POST /api/rest/2.0/template/variables/update-values
{ "variable_assignment": [{ "variable_identifier": "primaryconn_primary_data_schema",
                            "variable_values": ["ACME_PROD"], "operation": "ADD" }],
  "variable_value_scope": [{ "org_identifier": "ACME" }] }
```

Rules:

- **ADD only; never REPLACE or RESET.** A mis-scoped replace can wipe the values of Orgs
  already on the Model.
- **In case B, values before parameterizing.** Otherwise the Primary Org briefly reads
  through a variable with no value, and its own queries fail.
- **Check coverage yourself.** The publish check is an *existence* check: it passes if any
  field in the tree is parameterized. After 3a, confirm that every Table whose values
  differ between the two sides is parameterized and resolves to the copy's value for this
  Org. A missed Table silently shows the secondary Org the Primary Org's data.
- If Step 1 found connection properties that differ, the Org also needs
  `CONNECTION_PROPERTY` values (or the customer accepts the Primary Org's settings). How
  those are assigned depends on Q7; 3a stops until it is answered.

#### Variable naming

**Case A — no naming.** The name is read from the governed Table TML
(`schema: ${apj_sales_schema}`); 3a only adds a value under it.

**Case B — one variable per shared value, named so the result does not depend on the
order Models are migrated in.**

Tables that share a value share a variable: both `SALES_FACT` and `PRODUCT_DIM` in
`PRIMARY_DATA` → one variable. The variable's identity is **(connection, field, current
Primary value)**, and the name is built from exactly that, always:

| Rule | Example |
|---|---|
| Name = `{connection}_{current Primary value}_{field}`, slugified (lowercase, `_`) | `primaryconn_primary_data_schema` |
| **Reuse first.** A later Model whose Tables have the same connection, field and Primary value uses the existing variable | A second Model on `PRIMARY_DATA` → `primaryconn_primary_data_schema` |
| A different Primary value is a different variable | Tables on `PRIMARY_OTHER` → `primaryconn_primary_other_schema` |
| **Fallback:** Tables share the key, but their copy needs a **different** value in an Org that already has one | `primaryconn_primary_data_{model}_schema` |
| **Stop (case A′):** the *same* Table needs two values in one Org | — a data conflict, not a naming one |

Recommended fields are `databaseName` and `schemaName`; `tableName` only when Step 1 shows
the table names actually differ. Names are unique across the cluster, not per Org.

**The name is a label, never the decision.**

- **Reuse is decided from cluster state**, not from the name: which variable the Tables are
  already bound to (their TML), and each candidate variable's Primary value
  (`template/variables/search`). A name can go stale — the Primary value is itself a
  variable value and may change later.
- **A name that exists but does not match** — its Tables' connection, field or Primary value
  differ — is treated as taken: add `_2`, `_3`. Slugging can collide (`PRIMARY-DATA` and
  `PRIMARY_DATA` both become `primary_data`); never reuse on a name match alone.
- **The customer may override** the proposed name in the Step 1–2 report, e.g. an existing
  standard such as `tenant_schema`.
- Name length and allowed characters are Q35.

**Why always fold the value in.** `ts-publish-orgs` folds it only when one run sees more
than one value, so migrating Models one at a time would give the first Model a short name
and later ones long names, and `…_schema` would not say which schema it replaces. Tables
already parameterized by `ts-publish-orgs` keep their variable (case A); reuse is decided
by the key, so the two tools still interoperate.

**Reusing a variable that has no value for this Org yet** adds one; every Table already on
that variable would then read that value in this Org if ever published there. The report
says so before 3a runs.

The names proposed appear in the Step 1–2 report and are approved before 3a creates
anything.

**Rollback:** REMOVE this Org's value. In case B, also unparameterize and delete the
variable — only if this run created it.

### 3b. Re-key the copy's `obj_id`s (secondary Org — only if `needs_rekey`)

The copy inherited the governed objects' `obj_id`s — the Model's and also its Tables' and
Connection's — and an `obj_id` must be unique within an Org. Every copy object in
`needs_rekey` whose governed counterpart is published into the Org (Q7) is re-keyed, in
one `update-obj-id` call; otherwise 3c is refused.

```json
POST /api/rest/2.0/metadata/update-obj-id
{ "metadata": [{ "metadata_identifier": "<copy guid>",
                 "current_obj_id": "sales_model",
                 "new_obj_id": "sales_model__copy_acme" }] }
```

- The endpoint takes `metadata_identifier` **or** `current_obj_id`, not both, so the
  stale-value guard is a read of each header before the write: stop if any `obj_id` differs
  from Step 2's.
- A connection is re-keyed with `type: DATA_SOURCE` (verified live), in its own call.
- Re-key **the copy**, never the governed Model. The copy is deleted in Step 7, so the new
  value only has to last until then.
- Before and after values go to the ledger.

**Rollback:** set the previous value back — only after 3c is undone, or the clash returns.

### 3c. Publish (Primary Org)

```json
POST /api/rest/2.0/security/metadata/publish
{ "metadata": [{ "identifier": "<governed guid>", "type": "LOGICAL_TABLE" }],
  "org_identifiers": ["<secondary org>"] }
```

- **Never send `skip_validation`.** Publishing validates before writing and commits
  all-or-nothing, so a refused publish leaves nothing changed. That validation is the
  safety net.
- Whether the Tables must be listed or follow the Model depends on Q7. Until then the
  script lists the Model and its Tables.
- Already published to this Org (a re-run) → nothing is sent.

| Error | Cause |
|---|---|
| `Cannot publish/unpublish objects with Cohort Column as dependency` | A Set on the **governed** Model. Step 2 checked only the copy |
| `No template variable node found in the dependency tree` | 3a did not land |
| Duplicate custom object id | 3b skipped or failed |
| `Objects can only be published/unpublished from primary org` | The run was in the wrong Org |

**Rollback:** `security/metadata/unpublish` from this Org. Possible only before Step 5 —
afterwards repointed content depends on the published Model and unpublishing is refused.

### 3d. Verify the publish (secondary Org, read-only)

**Query data; never trust the publish's `204` alone.** Found live: after a successful
publish, Sage's indexing lagged — its org-aware snapshot did not yet include the secondary
Org, so every search on the published Model failed there (`searchdata` 11020 *"Invalid
data source guid"*; UI Ref 10028; Sage log `PERMISSION_DENIED_INACCESSIBLE_TO_ORG`). It was
still failing at least 17 minutes after the publish, then resolved on its own.

So 3d **waits and retries**: re-query the published Model every few minutes, up to a
limit (Q36). Only if it is still not searchable at the limit does 3d stop, with
"published, but not yet searchable in this Org — retry later or contact support". Steps
4–7 never start before 3d returns data: repointing would break every dependent.

- The published Model is visible in the secondary Org, and its GUID is the governed GUID.
- **Each published Table resolves to the copy's physical location** — the same `db` /
  `schema` / `db_table` Step 1 recorded. This is the tenant-isolation check: if the Org
  reads exactly what the copy read, the migration has exposed no other data. How to read
  the resolved values is Q13.
- The copy is present and unchanged apart from its `obj_id`.

### Output

A **ledger** in `plan.json`, one entry per write. It drives rollback in reverse order and
lets a re-run skip what is done.

```json
"ledger": [
  { "step": "3a", "action": "variable_value_add", "variable": "primaryconn_primary_data_schema",
    "org": "ACME", "value": "ACME_PROD" },
  { "step": "3b", "action": "update_obj_id", "guid": "…",
    "before": "sales_model", "after": "sales_model__copy_acme" },
  { "step": "3c", "action": "publish", "guid": "…", "org": "ACME" }
]
```

### Open questions — Step 3

13. **Reading resolved values.** How to see what a published Table resolves to in a given
   Org — `show_resolved_parameters` on `metadata/search`, or exporting the Table's TML in
   that Org?
14. **`metadata/parameterize` field names.** The exact `field_name` values
    (`databaseName`, `schemaName`, `tableName`?).
15. **ADD on an existing value.** With an `org_identifier` scope, does `update-values` ADD
    append a second value when one exists? Decides whether reading first is enough to
    detect case A′.

35. **Variable name limits** — what length and characters does `template/variables/create`
    accept?

36. **Sage indexing lag after a publish** — how long can it take before a published Model is
    searchable in the secondary Org? Sets 3d's retry limit. Observed: more than 17 minutes.

## Step 4 — Give the published Model the copy's permissions

Runs in the secondary Org, inside the downtime window, **before** any content is repointed,
so no user loses access at any point. Request shapes are from the REST spec shipped with
spotter-code.

**Preconditions:** Step 3 done and 3d passed; no dependent repointed yet.

### 4a. Read the current state (read-only)

1. **The copy's explicit sharing** — `security/metadata/fetch-permissions` on the copy with
   `permission_type: DEFINED` (10.3+). `DEFINED` returns only what was explicitly shared;
   without it the response lists effective access, including every administrator and one
   row per member of each shared group. This fresh read, taken at the start of the
   downtime window, is what Step 4 grants from — not the Step 2 snapshot.
2. **Current sharing on the published Model and its Tables** in this Org, so access that
   already exists is never lowered.
3. **Principals who see a dependent but not the copy** — from the dependents' sharing. Once
   their content sits on the published Model, Strict Object Mode requires access to the
   Model too. They are **not** granted automatically: Model access shows them far more
   than one Answer. Listed; the customer decides. *(Proposed — pending decision.)*
4. **Column security on the copy** — see 4d.

### 4b. What gets granted

Every explicit entry on the copy is carried to the same principal. The copy and the
published Model are in the same Org, so every principal already exists there.

| On the copy | On the published Model | Why |
|---|---|---|
| `READ_ONLY` | `READ_ONLY` | Same |
| `MODIFY` | `READ_ONLY`, disclosed in the report | A published object is edited from the Primary Org only; edit rights here would mean nothing (Q22) |
| `NO_ACCESS` (explicit) | `NO_ACCESS` | Keeps an exception, e.g. a user blocked inside a group that has access |
| The copy's author / owner | Listed, not shared by default | Authorship is not a share; usually it is the admin who ran the import |

**Never lower access:** a principal that already has equal or higher access on the
published Model is skipped.

### 4c. Grant (one run, one approval)

Bottom-up. Under Strict Object Mode a grant on an object whose source is not shared returns
`HTTP 204` and is **silently dropped** (found live by `ts-migrate-orgs`):

1. The published **Tables** — the same principals, `READ_ONLY`.
2. The published **Model** — the entries from 4b.

```json
POST /api/rest/2.0/security/metadata/share
{ "metadata": [{ "type": "LOGICAL_TABLE", "identifier": "<governed guid>" }],
  "permissions": [
    { "principal": { "type": "USER_GROUP", "identifier": "acme_analysts" }, "share_mode": "READ_ONLY" },
    { "principal": { "type": "USER",       "identifier": "jdoe" },          "share_mode": "NO_ACCESS" } ] }
```

- `message` is **required** despite the spec (a share without it is refused, verified live): send `"message": ""` and no `emails`. Whether principals are notified still depends on their notify-on-share setting (Q23).
- The run is scoped to the secondary Org; it cannot change the published Model's sharing
  in any other Org. Principals are per Org.

### 4d. Column security on the copy — detect and stop

The largest security risk in the migration. If the copy **hid columns** from a group —
column-level sharing on `LOGICAL_COLUMN`, or Column Security Rules
(`security/column/rules/fetch`) — the published Model carries no such restriction in this
Org. After the repoint the group would see columns it could not see before, with no error.

- **Found → stop before Step 5.** The report names each column and principal. The customer
  recreates the restriction on the published Model in this Org (the `ts-security-columns`
  flow), or explicitly accepts the change, then re-runs Step 4. *(Proposed — pending
  decision.)*
- **None found → continue.**

Detection is cheap and read-only. Recreating the restriction automatically is Phase 2
scope.

### 4e. Verify (read-only)

- `fetch-permissions` (`DEFINED`) on the published Tables and Model: every entry from 4b is
  present at the expected level.
- Read the **`permission`** field, not `shared_permission` — the latter stays `NO_ACCESS`
  on a successful share. `HTTP 204` alone does not prove a grant landed.
- Where possible, check as a **non-admin** member of a granted group; an admin sees objects
  regardless of sharing. Repeated in Step 6.

### Output

Ledger entries, one per principal and object:

```json
{ "step": "4c", "action": "share", "object": "<governed guid>",
  "principal": "acme_analysts", "before": "NONE", "after": "READ_ONLY" }
```

**Rollback:** for each entry this run added, restore its `before` value (`NO_ACCESS` where
there was none). Access that already existed is never touched.

### Open questions — Step 4

16. **Principals who see only a dependent** — ask the customer (proposed), or grant them
    `READ_ONLY` on the Model automatically?
17. **Column security on the copy** — stop until resolved (proposed), or warn only?
18. **Enforcing downtime for one Org** — see "Running the migration — downtime".
19. **Last-modified time** — which `metadata/search` header field it is, and whether every
    save changes it, including a Liveboard layout change.
20. **`force-logout` and embedded sessions** — does it end trusted-auth sessions, or only
    UI sessions?
21. **Strict Object Mode** — on for this cluster? Bottom-up granting is correct either way;
    it decides whether 4a item 3 matters.
22. **`MODIFY` on a published Model** — can it be granted in a secondary Org, and does it
    do anything?
23. **Notifications** — does `share` without `emails` still notify the principals?
24. **Column-level sharing on the copy** — is it read with `fetch-permissions` on
    `LOGICAL_COLUMN`, and can one call cover all columns?

## Step 5 — Repoint dependents

Runs in the secondary Org, inside the downtime window. The rewrite rules are those of
`ts-migrate-orgs` (thoughtspot-agent-skills `tools/ts-cli/ts_cli/migrate/rewrite.py`),
which were proven against real content; this step runs them through
`execute-thoughtspot-code` instead of a local CLI.

**Preconditions:** Step 4 done and 4e passed; the start-of-window re-checks passed; no
column security on the copy, or the customer accepted the change.

**Scope**, from the Step 2 list as refreshed at the start of the window, in this order:

1. **Views directly on the copy** — first, because everything on them depends on them.
2. **Answers and Liveboards directly on the copy.** A hidden visualization Answer is handled
   through its Liveboard, once.

Content reached through a View (`via_view`) is **not touched**.

### 5a. Back up each object (read-only)

Per object:

1. Record its **last-modified time `t0`**.
2. Export its TML (`export_fqn: true`) and compute a **SHA-256** of it in the sandbox.
3. Return the TML to the agent — **in slices** when it exceeds the 24,000-character return
   limit (Step 2's `tml_chars` gives the size in advance).
4. The agent joins the slices, checks the hash, and writes `backup/<guid>.tml`.

**Every backup exists before the first write.** A hash mismatch or a failed write stops
Step 5: that file is the only way back for the object.

### 5b. The rewrite

**1. Swap the Model reference.** In `tables[]`, only entries whose `fqn` is the copy's GUID
change: `fqn` → the governed GUID, and `name` / `id` → the governed name. A stale `name`
would let resolution fall back to a name match and bind to the wrong object if the `fqn`
ever failed to resolve. Entries for **other** sources are left alone — rebinding them
imports cleanly and renders wrong.

**2. Rename columns by the column map** (skipped when the verdict is `READY`: the map is
identity).

- **Denylist, not allowlist.** Every string is rewritten except known label fields
  (`LABEL_PATHS`: visualization titles, `answer.name`, filter display names, chart column
  labels). A reference field added by a future release is then covered automatically; the
  label list is the one thing to review when the platform changes.
- **Three reference forms:** bare `[Segment]`, qualified `Sales::Segment`, and decorated
  `Total Segment` inside `search_output_column`.
- **`client_state_v2`** — a JSON string holding chart state — is **parsed** and rewritten
  field by field, never by substring replacement, which corrupts unrelated state.

**3. Views.** Rewrite what the View **reads** (`search_query`, formulas,
`search_output_column`). **Preserve exactly** what it **exposes**: `view_columns[].name` and
the View's own name. Content on the View then needs no rewrite.

**4. Column rewrites are scoped to visualizations that read the copy.** `ts-migrate-orgs`
applies the map document-wide. Here it applies only inside visualizations whose `tables[]`
point at the copy: on a Liveboard that also shows another Model, a visualization on that
Model with its own `Segment` column must not be renamed.

**A Liveboard filter that spans the copy and another source, on a renamed column, stops
that object for manual handling.** It cannot be rewritten for one source without breaking
the other, and a wrong rewrite filters the other Model's visualizations by the wrong column
with no error. Such Liveboards are expected to be rare; the object stays on the copy (still
working) and is listed in the report.

### 5c. Checks before any import (inside the write run)

| Check | On failure |
|---|---|
| **Last-modified time is still `t0`** | Stop Step 5 — the downtime leaked |
| **Coverage:** no copy column name survives outside label fields, and no `fqn` still points at the copy | Do not import; report the paths. **Never work around it** — a partial rewrite imports cleanly and shows wrong numbers |
| **The map is injective**, and no target name collides with the object's own formulas | Do not import |
| **`tml/import` with `import_policy: VALIDATE_ONLY`** | Do not import; report the platform's error |

### 5d. Import and confirm (write)

- `metadata/tml/import`, `import_policy: ALL_OR_NONE`, `create_new: false`, over the same
  GUID. The GUID is unchanged, so sharing, schedules and favourites are expected to stay
  (Q29).
- **Confirm in the same run:** re-export and check every former copy reference now points
  at the governed GUID.
- Ledger: `MOVED`, with the backup path and hash.

### Batches and approvals

A write run costs about five calls per object (modified-time read, export, validate,
import, confirm). Within the 50-call and 150-second limits that is **up to about eight
objects per run**.

- **One approval per batch.** The customer sees the batch's objects and, for each, whether
  it needs a column rewrite or only the Model reference swapped.
- Views go in their own batch(es), first.
- **Stop at the first failure.** Objects already moved work on the published Model; the
  rest still work on the copy. Both are safe states. Investigate, then re-run — the ledger
  skips what is done.

### What a TML round trip may not keep

Conditional formatting, column widths, some chart state and Liveboard tile layout are not
guaranteed to survive a re-import (found by `ts-migrate-orgs`). Which columns an object
reads, what it computes and what it filters do survive.

- **Disclosed per object** in the report before the batch is approved.
- **Not a reason to refuse** — leaving content on a copy about to be deleted is worse.
- Step 6 checks that the **numbers** match, not that the documents match.

### Rollback

Re-import `backup/<guid>.tml` over the same GUID. Straightforward while the copy exists
(before Step 7); after the copy is deleted it depends on Q4.

### Output

```json
{ "step": "5d", "action": "repoint", "guid": "…", "type": "LIVEBOARD",
  "backup": "backup/<guid>.tml", "sha256": "…", "column_rewrite": true, "t0": "…" }
```

Objects stopped for manual handling are recorded as `MANUAL`, with the reason.

### Open questions — Step 5

25. **Import format and mode** — does `tml/import` accept the JSON export, and update in
    place with `create_new: false`?
26. **`tables[].name` / `id`** — must they equal the governed name, or is `fqn` enough?
27. **`VALIDATE_ONLY`** — does it catch a reference to a column that does not exist, or only
    malformed TML?
28. **`LABEL_PATHS`** — is the `ts-migrate-orgs` list still complete on the current release?
29. **In-place import** — do sharing, schedules, favourites and embed links survive?
30. **Hashing in the sandbox** — is `crypto.subtle` available in the code-exec engine?

## Step 6 — Verify

Read-only, in the secondary Org, inside the downtime window. **Step 6 is the gate for
Step 7: the copy is deleted only after it passes.**

### 6a. Everything resolves to the right Model

- **The copy's dependents** — re-run the lookup (2b). Only objects recorded as `MANUAL` in
  Step 5 may remain. Anything else is a failure: missed, or created during the window.
- **Every `MOVED` object** appears as a dependent of the **published** Model in this Org, and
  its re-exported TML holds no reference to the copy.
- **Views** — each repointed View depends on the published Model, and content on it still
  resolves through it.

### 6b. The numbers match

The "before" fingerprints are taken **at the start of the downtime window**, with the other
start-of-window checks — as late as possible, so warehouse data has little time to change.
Whether fingerprints are taken at all is Q9.

- **Answers** — `metadata/answer/data`: row count, plus a hash of the first N rows **sorted
  first**, since row order is not guaranteed.
- **Liveboards** — `metadata/liveboard/data` per visualization, batched within the 50-call
  and 150-second limits.
- **Content on Views** — sampled; it was not rewritten.
- **A mismatch is not rolled back automatically.** It is marked `REVIEW` and blocks Step 7.
  The customer compares, then accepts it or rolls that object back from its backup.

Administrators bypass RLS, but both readings come from the same admin session, so the
comparison is like for like. It proves the numbers did not change — **not** what a tenant
user sees. That is 6d.

### 6c. Access is right

- `fetch-permissions` (`DEFINED`) on the published Model and Tables matches what Step 4
  granted. Read `permission`, not `shared_permission`.
- **Each dependent's sharing** is unchanged from the start-of-window reading. This answers
  Q29 on real data.

### 6d. As a real tenant user (manual)

The skill cannot do this: code-exec runs as the connected admin, and acting as another user
would mean minting a token (a gated write that needs trusted authentication). The report
ends with a checklist the customer completes, logged in as a **non-admin** member of the
Org:

1. Open two or three moved Liveboards and Answers — they load and show data.
2. Row counts match what that user saw before — RLS still applies.
3. Columns hidden from them (if any were recreated after 4d) are still hidden.
4. They still see the copy as a second Model in the data picker — expected until Step 7.

The customer confirms the checklist before Step 7.

### Result

| Result | Meaning | Next |
|---|---|---|
| **PASS** | All checks pass; customer confirms 6d | Step 7 may run |
| **REVIEW** | Number mismatches, or `MANUAL` objects remaining | Step 7 blocked until each item is accepted or resolved |
| **FAIL** | Wrong Model reference, a missed dependent, or grants missing | Step 7 blocked; fix, or roll back the affected objects |

Recorded in `plan.json` as `verification`, with a status per object.

### Column names change for users (Phase 1: disclosed)

With a `RENAME` verdict, tenant users **see the governed Model's column names** after the
repoint — `Segment` becomes `STRING_1` in their Answers, search and Spotter. The data is
right; the labels change.

`ts-migrate-orgs` restores the tenant's names with **per-Org column aliases** on the
Primary Org's Model (`ts alias`, once per wave, with an `--expect-org` guard so aliases for
Orgs already cut over are not wiped). That writes to the governed Model in the **Primary**
Org and affects every Org, and it is the one step that tool calls catastrophic if done
wrong.

**Phase 1 discloses instead:** the Step 1–2 report lists every renamed column as "users will
now see X instead of Y", so the customer knows before approving. Aliases are a later phase.
Copies whose names match the governed Model (`READY`) are unaffected.

### Open questions — Step 6

31. **Large Liveboards** — how does `liveboard/data` behave within the limits; is sampling
    visualizations enough?
32. **Aliases on published Models** — do per-Org aliases render in Answers on the published
    Model in a secondary Org? Needed only when aliases are added.

## Step 7 — Delete the copy

The only step a re-import of an object's backup cannot undo, so it checks the most before
acting. Secondary Org.

**Preconditions:** Step 6 is **PASS**, or every `REVIEW` item has been accepted; the
customer confirmed the 6d checklist; **no `MANUAL` objects remain** — each still depends on
the copy and would break.

### 7a. Final sync

| Check | On failure |
|---|---|
| **The copy has zero dependents** (lookup 2b) | Do not delete; list what remains |
| **The copy is unchanged since the archive** — re-fingerprint and compare with `inputs/` | Stop; the rollback file no longer matches |
| **The copy's sharing, read again** — any share added since Step 4 | Apply it to the published Model first (a separate `share` run and approval, logged like Step 4), then continue |
| **The rollback set is complete** — the copy's TML, every `MOVED` backup (hashes checked), both sharing snapshots, the ledger | Stop; never delete without a complete way back |

Some uses of the copy are not dependents: embed code or scripts using its GUID or `obj_id`,
and Spotter conversations on it. The customer confirmed the `obj_id` case at 3b and
confirms the rest here.

### 7b. Delete (write — its own approval, never combined with other writes)

```json
POST /api/rest/2.0/metadata/delete
{ "metadata": [{ "type": "LOGICAL_TABLE", "identifier": "<copy guid>" }] }
```

**Identity check in the same run, immediately before the call.** Since Step 3 the governed
Model is visible in this Org too, so a wrong GUID could target the published Model. The
script re-reads the object and deletes only if **all** hold:

- the GUID equals `plan.copy.guid` and is **not** `plan.governed.guid`;
- it is **not** a published object;
- its `obj_id` is the value set in 3b (e.g. `sales_model__copy_acme`).

No `delete_disabled_objects`. Exactly one object per call.

**The copy's Tables (Q6 — decided)** exist only for the copy, so they are deleted **after the
copy Model**, each one only if it then has **zero dependents**. A Table something else still
reads — content built on it directly, another Model — is kept and listed in the report with
its dependents. Each Table gets the same identity check as the Model (the GUID is the
copy's Table, it is not a published object, its `obj_id` is the 3b value). The copy's
connection follows the same rule, last (Q8).

### 7c. Confirm (read-only)

- A search for the copy's GUID returns nothing.
- The published Model is present in the Org, and its dependents match Step 6.
- A spot re-run of 6a on a sample of moved objects.

The downtime window then ends and the customer re-opens access.

### Timing

Default: delete in the same downtime window. The customer may **defer** it — for example to
observe for a week. That is safe because 7a re-checks everything when it runs, including
content built on the copy in the meantime; the cost is users seeing two Models until then.

### Full rollback after deletion

Only the files and the ledger remain. In a downtime window, in this order:

1. **Recreate the copy** from `inputs/`, with the **re-keyed `obj_id`** — the original
   clashes with the published Model, still in the Org. Whether it gets its original GUID
   back is Q4 / Q34.
2. **Restore the copy's sharing** from the snapshot; TML carries none.
3. **Re-import each Step 5 backup.** They reference the copy's GUID; if the GUID changed,
   rewrite that reference first.
4. **Undo Step 4** — restore each `before` value in the ledger.
5. **Unpublish** from this Org — now possible, as nothing depends on the published Model.
6. **Restore the copy's `obj_id`** (undo 3b), then **remove this Org's variable value**
   (undo 3a).

Phase 1 documents this as a runbook, not an automated command.

### Output

```json
{ "step": "7b", "action": "delete", "guid": "<copy guid>", "obj_id": "sales_model__copy_acme",
  "rollback_set": { "copy_tml": "inputs/…", "backups": 23, "sharing_snapshot": "…" } }
```

The final report: moved / `MANUAL` objects, grants, the copy deleted, the copy's Tables and
connection left in place, and where the rollback set is.

### Open questions — Step 7

33. **Delete with dependents** — does `metadata/delete` refuse when dependents exist, or
    remove them with the copy? A second safety net if it refuses; critical to know if it
    cascades.
34. **Restore with a different `obj_id`** — can the copy be re-imported with its original
    GUID but the re-keyed `obj_id`? Pairs with Q4.
