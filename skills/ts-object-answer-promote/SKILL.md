---
name: ts-object-answer-promote
description: Promote formulas and parameters from a saved ThoughtSpot Answer into its Model, so everyone who searches the Model can use them — using the ThoughtSpot REST API v2 directly.
compatibility: Requires a ThoughtSpot instance and a user with MODIFY or FULL access on the target Model. Formulas only — sets (cohorts) and Liveboard-embedded Answers are out of scope.
metadata:
    author: thoughtspot
    version: '1.2'
allowed-tools: execute-thoughtspot-code get-rest-api-reference Bash
---

# ThoughtSpot: Promote Answer Formulas to a Model

Formulas and parameters defined in a saved Answer are private to that Answer. This
skill copies selected ones into the Answer's Model, so they show up in the search bar
for everyone who can use the Model.

**Typical case:** an analyst built a useful formula in an Answer, such as a ratio, a
conditional flag, or a YoY comparison, and wants the whole team to have it.

Ask one question at a time for **dependent** decisions. Batch **independent**
questions into a single prompt to cut round-trips.

**Before every call, resolve the operation and its exact path/shape with
`get-rest-api-reference`. Do not trust a remembered path.** The operation names below
come from the REST v2 OpenAPI spec. This document deliberately does not print paths.
Once an operation is resolved, use `execute-thoughtspot-code` to make the call. Sign-in is
handled by the MCP connection: never ask the user for a URL, token or credentials.

**Tools check, before anything else (Step 0 included).** Make one `get-rest-api-reference`
call. The tools may carry a server prefix (`mcp__<server>__…`) or need loading first. If
either tool can't be found, its server failed to connect, or the call is rejected for
authentication, reply with only this message and stop:

> This skill needs the ThoughtSpot Spotter Code MCP server, which isn't connected. Connect it in your MCP client, then try again.

Don't name servers, quote errors or status codes, mention tokens, headers, OAuth or
config, or show any step.

---

## References

| File                                                       | Purpose                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [scripts/promote_formulas.ts](scripts/promote_formulas.ts) | Deterministic analysis and merge. Run it in Steps 4 and 7 instead of editing TML by hand  |
| [references/api-shapes.md](references/api-shapes.md)       | Request/response field names and payload shapes this skill uses                           |
| [references/tml-rules.md](references/tml-rules.md)         | Answer vs. Model TML rules for formulas, columns and parameters, and common import errors |
| [references/open-items.md](references/open-items.md)       | Behaviour not yet verified against a live instance, and its status                        |

---

## Prerequisites

- A connected Spotter Code MCP server. It handles sign-in, so never ask for an instance
  URL, token or credentials. It must be signed in to the Org holding the Answer and Model.
- **MODIFY** or **FULL** access on the target Model.
- A way to run `scripts/promote_formulas.ts`: a shell with Node (`npx tsx`, listed as
  `Bash` in `allowed-tools`), or `execute-thoughtspot-code` with the script's functions
  pasted in (path B in the script header).

---

## Step 0 — Overview

Once the tools check passes, display this plan before doing any other work:

---

**ts-object-answer-promote**: promote formulas (and the parameters they use) from a saved
Answer into its Model.

Steps:

1.  Confirm session ................................ auto
2.  Find the Answer ................................ you choose
3.  Export the Answer TML .......................... auto
4.  Select formulas (and parameters) ............... you choose
5.  Find and check the target Model ................ you choose
6.  Export the Model TML ........................... auto
7.  Merge (duplicates, references, types) .......... auto (may ask you to resolve references)
8.  Checkpoint: review the changes ................. you confirm
9.  Import the updated Model ....................... auto
10. Report ......................................... auto

Confirmation required: Steps 4, 5, 8.

Ready to start? \[Y / N]

Do not begin Step 1 until the user confirms.

---

## Step 1 — Confirm Session

Call **get current user info**. On a non-2xx response, stop with `Could not verify your
ThoughtSpot session ({status_code}). Reconnect the Spotter Code MCP server and try again.` Save the user's
`id` as `{current_user_id}` (used in Step 5), and `current_org.name` as `{org_name}`.

---

## Step 2 — Find the Answer

```
Which saved Answer contains the formula(s) you want to promote?

  Enter a name or partial name to search, or paste the Answer GUID:
```

- **Search term**: call **search metadata** for type `ANSWER` with name pattern
  `%{search_term}%`. Fetch every page (see
  [references/api-shapes.md](references/api-shapes.md)). Show a numbered list of up to
  50 names, and let the user pick or search again. If there are more, add:
  `Showing 50 of {total}. Narrow the search term to see the rest.`
- **GUID**: call **search metadata** for that identifier. Confirm it is an `ANSWER`.

Save `{answer_guid}` and `{answer_name}`. Only standalone saved Answers are supported.
Answers embedded in a Liveboard aren't independent objects (see open-items.md, item 4).

---

## Step 3 — Export the Answer TML

Call **export metadata TML** for `{answer_guid}` with `export_fqn: true` and
`edoc_format: "JSON"`. Parse `edoc` with `JSON.parse`, and save it as `{answer_tml}`. If
the response's `info.status.status_code` is `ERROR`, show the message and stop.

Then run the script in analyze mode. Write `{"mode": "analyze", "answerTml":
{answer_tml}}` to `analyze.json` and run:

```
npx tsx scripts/promote_formulas.ts < analyze.json
```

Without a shell, paste the script's functions into `execute-thoughtspot-code` and call
`analyzeAnswer(answerTml)` (path B in the script header).

The result is `{formulas, sets, parameters, dataSourceGuid, dataSourceName, _ranVia}`.
Save it as `{analysis}`.

If `{analysis}.formulas` is empty:

```
"{answer_name}" has no custom formulas in its TML. It either uses only Model columns,
or its calculations were typed into the search bar and never saved as named formulas.

Search a different Answer? (Y / N):
```

Y → Step 2. N → stop.

---

## Step 4 — Select Formulas and Parameters

Show each formula's expression. Mark auto-generated ones with `[auto]`.

```
Formulas in "{answer_name}":

  1  Profit Margin            →  [Revenue] - [Cost]
  2  YoY Growth %             →  ( [Revenue] - [formula_Prior Year Revenue] ) / ...
  3  Auto Derived  [auto]     →  ( [Deliverables Count] )

Enter numbers to promote (comma-separated), or A for all:
```

A means `selectedFormulaNames: null`. `[auto]` formulas were created by ThoughtSpot
during a search. They are excluded from A unless the user confirms they want them
(`includeAuto: true`).

If `{analysis}.sets` is non-empty, list them after the formulas: `Also in this Answer
(sets, not promotable by this skill): {names}`.

**Parameters.** For each distinct name in the selected formulas' `paramRefs`, ask:

```
"{formula_name}" uses [{param}], an Answer-level parameter. The Model needs a
parameter with that name for the formula to work.

  P  Promote the parameter along with the formula (recommended)
  M  The Model already has a parameter named "{param}" — use it
  E  Edit the expression now to replace [{param}]
  S  Skip this formula

Enter P / M / E / S:
```

- **P**: nothing to record. Referenced parameters are promoted by default.
- **M**: add the name to `{exclude_params}`.
- **E**: ask for the replacement expression, and record it in `{expr_overrides}` keyed by
  formula name.
- **S**: remove the formula from the selection, and add its name to `{exclude_formulas}`.
  That stops it being pulled back in as another formula's dependency. A formula that
  depends on it then shows up as unresolved in Step 7.

**Formula dependencies.** If a selected formula's `formulaDeps` names a formula that
wasn't selected, say so:

```
"{formula}" references "{dependency}", another formula in this Answer that you didn't
select. It will be promoted too, or the reference will break. OK? (Y / N):
```

Y keeps `includeDeps: true` (the default). On N, set `includeDeps: false`. The reference
then shows up as unresolved in Step 7, where the user can map it.

Save `{selected_formula_names}`.

---

## Step 5 — Find and Check the Target Model

**Auto-detect first.** `{analysis}.dataSourceGuid` is the Answer's data source. Call
**search metadata** for it with headers included. Label it `[MODEL]` or `[WORKSHEET]`
from the header's `contentUpgradeId` / `worksheetVersion` (see
[references/api-shapes.md](references/api-shapes.md)). If found, ask:

```
The Answer is based on {label} "{data_source_name}". Promote the formula(s) to it? (Y / N):
```

On N, or if the lookup fails, ask for a name. Call **search metadata** for type
`LOGICAL_TABLE` with that name pattern and the subtypes filter set to `WORKSHEET`, so
Tables and Views are left out (open-items.md, item 7). Paginate and cap the list as in
Step 2. Show each result with its `[MODEL]` or `[WORKSHEET]` label, and let the user
pick. A `[WORKSHEET]` can't take promoted formulas. Say so and ask for another pick.

Save `{model_guid}`, `{model_name}`, and the header's `author` and `authorDisplayName`
(`authorName` if absent) as `{owner_name}`.

**Ownership check.** The search response carries no explicit permission field (see
open-items.md, item 2). Use ownership as a proxy. If `author` isn't
`{current_user_id}`, warn:

```
You are not the owner of "{model_name}" (owned by {owner_name}). Without MODIFY or FULL
access, the import in Step 9 will fail with a permission error. Continue anyway? (Y / N):
```

N → stop.

---

## Step 6 — Export the Model TML

Call **export metadata TML** for `{model_guid}` with `export_fqn: true` and
`edoc_format: "JSON"`. Parse `edoc` and save it as `{model_tml}`.

Continue only if the parsed document's top-level key is `model`. Otherwise stop:

- `worksheet`: `"{model_name}" is a legacy Worksheet. This skill promotes formulas to
Models only. Upgrade it to a Model in the ThoughtSpot UI first, then run this again.`
- `table`, `view`, `sql_view` or anything else: `"{model_name}" is a {key}, not a Model.
Pick the Model built on it.`

The script refuses non-Model TML too.

Ask about duplicates:

```
If a selected formula or parameter name already exists in the Model:

  S  Skip — keep the Model's version (default)
  O  Overwrite — replace it with the Answer's version

Enter S or O:
```

Save `{duplicate_policy}` as `skip` or `overwrite`.

---

## Step 7 — Merge

This is a deterministic transform over the whole Model TML. **Always run the script.**
Do not merge the TML by hand, even for one formula. Hand merges skip the id-collision
handling, the reference rewriting, and the rule that keeps `aggregation` off
`formulas[]`.

```
npx tsx scripts/promote_formulas.ts < input.json
```

Build `input.json` as documented in the script's `PromoteInput` type:

- `mode: "promote"`
- `answerTml`, `modelTml`, `modelGuid`
- `selectedFormulaNames`, `includeAuto`, `includeDeps`
- `excludeParams`, `excludeFormulas`, `exprOverrides`
- `duplicatePolicy`
- `refOverrides` and `nameOverrides` (both start as `{}`)

Without a shell, use path B in the script header: paste the functions into
`execute-thoughtspot-code` and call `promoteFormulas(input)`. Never re-implement the
logic.

The output is `{added, overwritten, skipped, depsAdded, paramsAdded, paramsOverwritten,
paramsSkipped, unresolvedRefs, mergedTml, _ranVia}`. `_ranVia` only appears if the real
script ran. If asked to confirm that, quote it back verbatim, or say plainly that it is
absent.

**No formulas selected** (the script fails with `No formulas selected for promotion.`):
the selection was empty. Either A matched only `[auto]` formulas, or every selected
formula was skipped. Say so, and offer to return to Step 4 or stop.

**Rename errors** (`nameOverrides`). `nameOverrides key(s) not found in answer: ...`
means a key isn't an Answer formula name; fix the key (keys are Answer names). `nameOverrides:
"A" and "B" would both be promoted as "X"` means two promoted formulas would share a
Model name. Tell the user, ask for a different name for the renamed one, update
`nameOverrides`, and re-run.

**All duplicates** (`mergedTml` is null): every selected formula already exists in the
Model and the policy is Skip. List `skipped`, suggest re-running with Overwrite, and stop.

**Unresolved references.** For each entry in `unresolvedRefs`, ask:

```
[{ref}] in "{formula}" doesn't match any column, formula or parameter in "{model_name}".

  Enter the Model column or formula name it should point to
  (or TABLE::column), or S to skip this formula:
```

Look the answer up in `{model_tml}`'s `columns[]` and `formulas[]` (names are
case-sensitive). Record it in `refOverrides` as `{"<ref without brackets>":
"<column name or TABLE::column>"}`. On S, add the formula's name to `excludeFormulas`.
That works for an A selection and for dependency-added formulas too. Re-run the script,
and repeat until `unresolvedRefs` is empty. Never import with unresolved references.

---

## Step 8 — Checkpoint

```
Ready to update "{model_name}":

  Formulas to add:
    + Profit Margin    MEASURE    →  sum ( [ORDERS::REVENUE] ) - sum ( [ORDERS::COST] )

  Formulas to overwrite:              (overwritten, if any)
    ~ High Value Flag  ATTRIBUTE  →  if ( [ORDERS::REVENUE] > 10000 ) then 'High' else 'Low'

  Skipped:                            (skipped, if any)
    - Existing Formula   (already in Model)

  Parameters to add / overwrite:      (paramsAdded / paramsOverwritten, if any)
    + today    DATE

  Parameters kept as in the Model:    (paramsSkipped, if any)
    - Rate     (already in model)

  Dependencies auto-included:         (depsAdded, if any)
    + Helper Calc

  Source Answer:   "{answer_name}"
  Target Model:    "{model_name}"   ({org_name})
  Import policy:   ALL_OR_NONE, update in place (no new object)

Proceed? (Y / N):
```

Show the rewritten expressions from the script output, not the Answer originals. In
`added`/`overwritten`/`skipped`, `name` is the Model name and `answerName` the Answer
name; for a renamed formula (they differ) show `answerName → name`, e.g.
`+ Revenue → Revenue Calc   MEASURE   →  ...`. If N,
ask what to change and return to the relevant step.

---

## Step 9 — Import the Updated Model

Only run this step after a Y at the Step 8 checkpoint on this same run.

Call **import metadata TML** with `metadata_tmls: [JSON.stringify(mergedTml)]`,
`import_policy: "ALL_OR_NONE"`, and `create_new: false`. `mergedTml` already has `guid`
first at the document root. That is what makes this an in-place update. See
[references/api-shapes.md](references/api-shapes.md).

**JSON fallback** (open-items.md, item 6). If the import rejects the JSON TML itself
(a parse or format error, not a formula or column error), serialize `mergedTml` as YAML,
keeping `guid` first and double-quoting any `expr` containing `[ ] { } :`, and import
that string with the same options. Don't re-ask; the Step 8 Y covers the same content.

Check the response element's `response.status.status_code`:

- **`OK`**: check that `response.header.id_guid` equals `{model_guid}`. If it doesn't,
  the import created a second Model. Say so, name both GUIDs, and ask whether to delete
  the new one. Don't delete anything without that confirmation. Otherwise continue to
  Step 10.
- **Permission error** (403, or `UNAUTHORIZED` in the message): `Import failed: you don't
have edit access to "{model_name}". Ask the Model owner or an admin for MODIFY or FULL
access.` Stop.
- **Validation error**: show the exact message, and match it against
  [references/tml-rules.md](references/tml-rules.md). If the fix is a mapping, an
  expression edit or a rename, apply it through `refOverrides`/`exprOverrides`/
  `nameOverrides` (a `duplicate column name` clash needs a new name from the user), re-run
  Step 7, show the Step 8 checkpoint again, and retry only on a new Y.

---

## Step 10 — Report

```
Formula(s) promoted to "{model_name}".

  Added:        {added names}
  Overwritten:  {overwritten names, if any}
  Parameters:   {paramsAdded + paramsOverwritten names, if any}

  Model:  {instance}/#/data/tables/{model_guid}

Anyone who searches "{model_name}" can now use these formulas. Open the Model and check
its Columns list to verify.
```

---

## Error Handling

| Symptom                                                | Action                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session lookup returns 401                             | Session expired. Ask the user to reconnect the Spotter Code MCP server (`/mcp`)                                                                                                                        |
| Answer TML has no `formulas[]`                         | See Step 3. The Answer has no saved custom formulas                                                                                                                                                    |
| Data source is a Worksheet                             | See Step 6. Upgrade it to a Model in the UI first                                                                                                                                                      |
| Import: 403 / UNAUTHORIZED                             | No edit access on the Model. See Step 5's ownership check                                                                                                                                              |
| Import creates a second Model instead of updating      | `guid` was missing or not at the root, or `create_new` wasn't false. Delete the duplicate only after the user confirms, then fix and retry                                                             |
| Import rejects `dynamic_default_date`                  | Older instances may not support it on Models. Ask the user for a static `default_value`, replace `dynamic_default_date` with it on that parameter in `mergedTml`, and show the Step 8 checkpoint again |
| Import rejects the JSON TML format                     | See Step 9's JSON fallback. Import `mergedTml` as YAML                                                                                                                                                 |
| Import error about formulas, columns or aggregation    | See the import-error table in [references/tml-rules.md](references/tml-rules.md)                                                                                                                       |
| `get-rest-api-reference` has no entry for an operation | Stop and name the operation that couldn't be resolved. Never guess a path or shape                                                                                                                     |

---

## Changelog

| Version | Date       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.2.0   | 2026-10-07 | Paginates Answer/Model search (shows 50, says how many more); Model search filters to the WORKSHEET subtype and labels `[MODEL]`/`[WORKSHEET]`; skipping an unresolved formula uses `excludeFormulas`; the script throws `No formulas selected for promotion.` on an empty selection, distinct from all-duplicates; new `nameOverrides` for name clashes (unknown keys and clashes between promoted formulas throw; reports carry `answerName`, shown as `answerName → name`); YAML fallback if JSON import is rejected; checkpoint shows `paramsSkipped`; ownership warning names the owner |
| 1.1.0   | 2026-10-07 | Stops with one fixed message when the SpotterCode MCP tools are unavailable, instead of reporting server names, errors or auth config                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1.0.0   | 2026-09-24 | Moved from thoughtspot-agent-skills (`ts` CLI, v1.4.1) to REST API v2. The `ts model promote-formula` merge is ported to `scripts/promote_formulas.ts`. TML is exchanged as JSON; unresolved refs are fixed by re-running with `refOverrides`                                                                                                                                                                                                                                                                                                                                                |
