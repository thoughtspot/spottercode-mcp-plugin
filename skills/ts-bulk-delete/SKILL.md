---
name: ts-bulk-delete
description: Bulk delete ThoughtSpot metadata objects — every downstream dependent of an object, everything carrying a tag, or an explicit list of GUIDs — with optional TML export first and a typed confirmation, using the ThoughtSpot REST API v2 directly. Not for stale-content archival or deleting content tagged for an archive review (INACTIVE) — use ts-content-archive.
compatibility: Requires a ThoughtSpot instance and a user who can delete the targeted objects (their owner, or an ADMINISTRATION-privileged user).
metadata:
    author: thoughtspot
    version: '1.0'
allowed-tools: execute-thoughtspot-code get-rest-api-reference Bash
---

# ThoughtSpot: Bulk Delete Objects

Delete many metadata objects in one run, selected in one of three ways:

- every object downstream of one GUID (for example everything built on a Table)
- every object carrying a tag
- an explicit GUID list

You can export each object's TML first, which gives you a restore path. This skill
selects objects by the rule you give it, not by usage. To find and tag stale content by
usage, use `ts-content-archive` instead.

**Deletion is permanent.** Nothing is deleted without a preview and a typed count
confirmation on the same run.

Ask one question at a time for **dependent** decisions. Batch **independent**
questions into a single prompt to cut round-trips.

**Before every call, resolve the operation and its exact path/shape with
`get-rest-api-reference`. Do not trust a remembered path.** The operation names below
come from the REST v2 OpenAPI spec. This document deliberately does not print paths.
Once an operation is resolved, use `execute-thoughtspot-code` to make the call. How the
bearer token is obtained and attached is the consumer's responsibility, not this skill's.

---

## References

| File                                                 | Purpose                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| [references/api-shapes.md](references/api-shapes.md) | Request/response field names and payload shapes this skill uses    |
| [references/open-items.md](references/open-items.md) | Behaviour not yet verified against a live instance, and its status |

---

## Prerequisites

- A valid bearer token for the target instance. If Orgs are enabled, it must already be
  scoped to the target Org.
- Ownership of every targeted object, or the `ADMINISTRATION` privilege.

---

## Step 0 — Overview

On skill invocation, display this plan before doing any work:

---

**ts-bulk-delete**: delete objects downstream of a GUID, by tag, or from a GUID list.

Steps:

1.  Confirm session ............................ auto
2.  Choose mode ................................ you choose
3.  Collect inputs ............................. you choose
4.  Gather objects ............................. auto
5.  Preview .................................... auto
6.  Export options ............................. you choose
7.  Confirm .................................... you confirm (checkpoint)
8.  Export TML (if requested) .................. auto
9.  Delete ..................................... auto

Not reversible unless you export TML first.

Ready to start? \[Y / N]

Do not begin Step 1 until the user confirms.

---

## Step 1 — Confirm Session

Call **get current user info**.

- **Non-2xx** (401/403/expired): stop with `Could not verify your ThoughtSpot session
({status_code}). Re-authenticate and try again.`
- **2xx**: read `privileges`, `current_org`, and `orgs`. Save `{is_admin}` as whether
  `privileges` contains the exact string `ADMINISTRATION`.

If Orgs are enabled, state the scope up front. There is no Org switch in this flow:

`This session is authenticated against Org "{org_name}". Only objects in this Org can
be deleted. For a different Org, re-authenticate with a token scoped to it.`

If `{is_admin}` is false, warn but continue: `You are not an administrator. Objects you
don't own will fail to delete and will be listed in the final report.`

---

## Step 2 — Choose Mode

```
What would you like to delete?

  1  Downstream — every object that depends on one GUID (the GUID itself is kept)
  2  By tag     — every Connection, Table/Model, Liveboard and Answer carrying a tag
  3  Tag only   — delete the tag definition itself, not the objects it's on
  4  GUID list  — an explicit list of GUIDs (pasted, or a CSV file with a guid column)

Enter 1, 2, 3, or 4:
```

Save `{mode}`.

---

## Step 3 — Collect Inputs

- **Downstream**: `GUID of the object whose dependents should be deleted:`. Save
  `{root_guid}`.
- **By tag / Tag only**: `Tag name (case-sensitive):`. Save `{tag_name}`.
- **GUID list**: `Paste GUIDs (comma- or newline-separated), or give a CSV path:`.
    - For a CSV, read it with your shell tool and take the `guid` column. If there is no
      such column, ask which one to use. Without a shell tool, ask the user to paste the
      values instead.
    - Trim and de-duplicate. Flag anything that isn't a 36-character GUID, and ask
      whether to drop it.
    - Save `{guid_list}`.

---

## Step 4 — Gather Objects

Build `{targets}`: a list of `{guid, name, type, author, modified}`, de-duplicated by
GUID. See [references/api-shapes.md](references/api-shapes.md) for every shape below.

**Downstream**: call **search metadata** for `{root_guid}` with details and dependent
objects included, and an unlimited dependent record size.

- If the root is a **Connection**, dependents don't come back directly (open item 1).
  Take the Connection's logical tables from its details, then search each table's
  dependents. Include the tables themselves as targets.
- Otherwise, flatten `dependent_objects` into `{targets}`.
- Never add `{root_guid}` itself.

If the search fails or returns nothing, say `No dependents found for {root_guid}. Are
you in the correct Org?` and stop.

**By tag**: first call **search tags** for `{tag_name}`. If there is no match, report
`No tag found with the name '{tag_name}'.` and stop. Otherwise call **search metadata**
filtered by that tag, for types `CONNECTION`, `LOGICAL_TABLE`, `LIVEBOARD`, and `ANSWER`.
Paginate with `record_offset` until a page is shorter than `record_size`.

If nothing carries the tag, report `No content currently carries the '{tag_name}' tag.`
and stop.

**Tag only**: call **search tags** for `{tag_name}` and stop if it's missing. Save its
id as `{tag_id}`. `{targets}` is just the tag. Skip to Step 7. There is nothing to
preview or export.

**GUID list**: call **search metadata** for the GUIDs in `{guid_list}` (batch them into
one call where the spec allows). Any GUID that comes back with no object goes into
`{not_found}`. Show those to the user, and don't try to delete them.

If `{targets}` is empty, say so and stop.

---

## Step 5 — Preview

Show up to 15 rows, most recently modified first. Then show a count by type:

```
{n} object(s) will be deleted:

  TYPE           NAME                          AUTHOR          MODIFIED
  ─────────────  ────────────────────────────  ──────────────  ─────────────
  LIVEBOARD      Q3 Exploratory Dashboard       jane.doe        142 days ago
  LOGICAL_TABLE  Sales Model                    john.smith       12 days ago
  ...

{"(+n more not shown)" if n > 15}

By type: {LIVEBOARD: a, ANSWER: b, LOGICAL_TABLE: c, CONNECTION: d}
{"Not found (skipped): " + not_found if any}
```

In **Downstream** mode, if any target is a `LOGICAL_TABLE` or `CONNECTION`, add this
line: `Includes data objects. Anything built on them outside this list will break.`

---

## Step 6 — Export Options

```
Export TML before deleting? (Y / N) — strongly recommended, gives you a restore path
  If Y: which local directory should exports be saved to?
  If Y: export only, without deleting? (Y / N)
```

Save `{export_directory}` (or none) and `{export_only}`. If `{export_only}` is Y, skip
Step 7's confirmation, run Step 8, and stop.

---

## Step 7 — Confirm

```
{n} object(s) will be PERMANENTLY DELETED:     ← Tag only: "Tag '{tag_name}' will be PERMANENTLY DELETED"

  Mode:              {mode}{" — root " + root_guid | " — tag " + tag_name}
  Org:               {org_name}
  Export TML first:  {"Yes, to " + export_directory if export_directory else "No — this is not reversible"}

Type the number of objects ({n}) to confirm deletion:     ← Tag only: type the tag name
```

Require the exact count (or, in Tag-only mode, the exact tag name) typed back. Y/N is
not enough. If it doesn't match, stop without deleting. Re-show the preview and ask
again only if the user asks to.

---

## Step 8 — Export (if requested)

Runs after the Step 7 confirmation, or directly when the user chose export only. Call
**export metadata TML** for each target, as YAML with FQNs. Run up to 4 at a time. For
each object, take the TML type from the response (`info.type`, for example `liveboard`,
`answer`, `model`, `table`, `connection`). Write the TML to
`{export_directory}/{info.type}/{guid}.{info.type}.tml`, the same layout cs_tools uses,
with your shell tool. Without a shell tool, hand each file's path and content to the
consumer to save, and say plainly that nothing was written to disk.

A target whose export response has `status_code: "ERROR"` goes into
`{export_failed}`. If that list is non-empty, show it and ask:

```
{k} object(s) could not be exported. Delete them anyway (no restore path)? (Y / N):
```

On N, remove them from `{targets}`. If `{export_only}` is set, report the export result
and stop.

---

## Step 9 — Delete

Only run this step after the confirmation from Step 7 on this same run.

**Tag only**: call **delete tag** with `{tag_id}`. The objects that carried the tag are
untouched. On a non-2xx response, report `Could not delete tag '{tag_name}' ({status}):
{error_message}` and stop. Don't report success.

**Everything else**: call **delete metadata**, one object per call, so that one failure
doesn't block the rest. Run up to 15 at a time. Order by dependency, so each object is
deleted before whatever it's built on:

1. `LIVEBOARD`, `ANSWER`
2. `LOGICAL_TABLE` objects that are Models/Worksheets/Views
3. remaining `LOGICAL_TABLE` objects (Tables)
4. `CONNECTION`

A delete can fail because a dependent hasn't gone yet. Retry failures in rounds, up to
11 attempts per object (cs_tools gives up after the 11th). Wait a few seconds between rounds,
and longer after a 429. You can stop early only when **every** remaining failure is
permanent: a 403 (not the owner), or a 400 saying the object doesn't exist. Keep retrying
429s, 5xx errors, timeouts and dependency errors to the full limit. Anything still
failing goes into `{delete_failed}` with its last error message.

```
Deleted {deleted} of {n} object(s).
{"TML exported to " + export_directory if export_directory else ""}

{if delete_failed:}
Failed ({k}):
  TYPE           NAME                  ERROR
  LOGICAL_TABLE  Sales Model           403 — not the owner
  ...
```

Deletion can take a moment to propagate. If an object still shows up right after
success, re-check before treating it as a failure.

---

## Error Handling

| Symptom                                                | Action                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Session lookup returns 401/403                         | Bearer token expired or invalid. The consumer must re-authenticate                                                                   |
| Downstream search returns nothing for a known GUID     | Likely the wrong Org, or the object is a Connection whose dependents need the per-table path (Step 4). Never delete the root instead |
| Tag not found                                          | Tag names are case-sensitive. Report it and re-ask                                                                                   |
| Delete returns 403 for some objects                    | The user doesn't own them and isn't an admin. List them in the failure report. Don't retry past the round limit                      |
| Delete keeps failing on a data object                  | Something outside `{targets}` still depends on it. Report it. Don't widen the target set without a new preview and confirmation      |
| Typed confirmation doesn't match                       | Stop. Delete nothing                                                                                                                 |
| `get-rest-api-reference` has no entry for an operation | Stop and name the operation that couldn't be resolved. Never guess a path or shape                                                   |

---

## Changelog

| Version | Date       | Summary                                                                                                                                                                                                                                                                                      |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-09-24 | Ported from the cs_tools `bulk-deleter` CLI tool (downstream, from-tag, from-tabular) to REST API v2. Tag-only is its own mode. Confirmation is always required. Avoids two source crashes: from-tag declared its GUID set as `{}` (a dict), and downstream failed on an empty search result |
