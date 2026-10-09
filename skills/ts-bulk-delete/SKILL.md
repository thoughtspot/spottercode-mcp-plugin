---
name: ts-bulk-delete
description: Bulk delete ThoughtSpot metadata objects — every downstream dependent of an object, everything carrying a tag, or an explicit list of GUIDs — with optional TML export first and a typed confirmation, using the ThoughtSpot REST API v2 directly. Not for stale-content archival or deleting content tagged for an archive review (INACTIVE) — use ts-content-archive.
compatibility: Requires a ThoughtSpot instance and a user who can delete the targeted objects (their owner, or an ADMINISTRATION-privileged user).
metadata:
    author: thoughtspot
    version: '1.2'
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

| File                                                 | Purpose                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| [references/api-shapes.md](references/api-shapes.md) | Request/response field names and payload shapes this skill uses    |
| [references/open-items.md](references/open-items.md) | Behaviour not yet verified against a live instance, and its status |

---

## Prerequisites

- A connected Spotter Code MCP server. It handles sign-in, so never ask for an instance
  URL, token or credentials. If Orgs are enabled, it must be signed in to the target Org.
- Ownership of every targeted object, or the `ADMINISTRATION` privilege.

---

## Step 0 — Overview

Once the tools check passes, display this plan before doing any other work:

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
10. Report (optional) .......................... you choose

You can stop at Step 7 with a preview only, or export TML without deleting anything.
Not reversible unless you export TML first.

Ready to start? \[Y / N]

Do not begin Step 1 until the user confirms.

---

## Step 1 — Confirm Session

Call **get current user info**.

- **Non-2xx** (401/403/expired): stop with `Could not verify your ThoughtSpot session
({status_code}). Reconnect the Spotter Code MCP server and try again.`
- **2xx**: read `privileges`, `current_org`, and `orgs`. Save `{is_admin}` as whether
  `privileges` contains the exact string `ADMINISTRATION`.

If Orgs are enabled, state the scope up front. There is no Org switch in this flow:

`This session is authenticated against Org "{org_name}". Only objects in this Org can
be deleted. For a different Org, sign in to that Org and re-run.`

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
    - Only pasted GUIDs or a CSV file are accepted. cs_tools could also read the list from
      a syncer (a database, Snowflake, Excel and so on). That isn't supported here: export
      the list to a CSV with a `guid` column first.

---

## Step 4 — Gather Objects

Build `{targets}`: a list of `{guid, name, type, subtype, author, author_guid,
modified}`, de-duplicated by GUID. `subtype` is the header's `type` (for example
`WORKSHEET`, `MODEL`, `ONE_TO_ONE_LOGICAL`) and is used to order deletes in Step 9. See [references/api-shapes.md](references/api-shapes.md) for every shape below.

**Downstream**: call **search metadata** for `{root_guid}` with details and dependent
objects included, and an unlimited dependent record size.

- If the root is a **Connection**, dependents don't come back directly (open item 1).
  Take the Connection's logical tables from its details, then search each table's
  dependents. Include the tables themselves as targets. If any per-table search fails
  (non-2xx, or a timeout after one retry), handle it like a failed By-tag fetch below.
  When every table is done, name the failed table(s), then ask:

    ```
    Could not fetch dependents of: {table_name} ({table_guid}), ...
    The target list is incomplete. Continue with the {n} object(s) found (partial)? (Y / N):
    ```

    On N, stop. On Y, set `{partial}`, so the Step 5 header shows the PARTIAL marker.

- Otherwise, flatten `dependent_objects` into `{targets}`.
- Never add `{root_guid}` itself.

If the root search fails or returns nothing, say `No dependents found for {root_guid}.
Are you in the correct Org?` and stop.

**Tag lookup** (By tag and Tag only): call **search tags** for `{tag_name}` (open
item 3). If that operation can't be resolved with `get-rest-api-reference`, or it returns
no match, fall back to **search metadata** with type `TAG` and `{tag_name}` as the
identifier, which is how cs_tools resolves tags. Match the name exactly, case included.
If neither finds it, report `No tag found with the name '{tag_name}'.` and stop. Save
its id as `{tag_id}`.

**By tag**: call **search metadata** filtered by `{tag_id}`, once per type:
`CONNECTION`, `LOGICAL_TABLE`, `LIVEBOARD`, and `ANSWER`. Paginate with `record_offset`
until a page is shorter than `record_size`.

If any type or page fails (non-2xx, or a timeout after one retry), don't drop it
silently. When every fetch is done, report which type and offset failed, then ask:

```
Could not fetch: {type} (from offset {record_offset}), ...
The target list is incomplete. Continue with the {n} object(s) found (partial)? (Y / N):
```

On N, stop. On Y, set `{partial}` and carry on. cs_tools logged the error and continued
without saying so.

If nothing carries the tag, report `No content currently carries the '{tag_name}' tag.`
and stop.

**Tag only**: run the tag lookup above. `{targets}` is just the tag. Skip to Step 7.
There is nothing to preview or export.

**GUID list**: call **search metadata** for `{guid_list}` in batches of at most 25
identifiers per call (as cs_tools does), with `record_size` set to at least the batch
size. Without it the default page size truncates the response and later GUIDs look
missing. Treat a GUID as missing only when a complete (2xx) response omits it. A failed
batch is retried once, then handled like a failed By-tag fetch above.

A search by identifier alone may not return Connections (open item 4). Retry each
missing GUID once with type `CONNECTION`. If it's still missing, add it to
`{not_found}`. Show those to the user, and don't try to delete them.

If `{targets}` is empty, say so and stop.

---

## Step 5 — Preview

Show up to 15 rows, most recently modified first. Then show a count by type:

```
{n} object(s) will be deleted{" (PARTIAL — some fetches failed)" if partial}:

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
Export TML?
  1  Export, then delete      — strongly recommended, gives you a restore path
  2  Export only              — save TML, delete nothing
  3  No export                — delete without a restore path

Enter 1, 2, or 3:
  If 1 or 2: which local directory should exports be saved to?
```

Save `{export_directory}` (or none) and `{export_only}`. Export only needs a directory,
as cs_tools' `--export-only` does. Re-ask until one is given. Export only is
non-destructive, so it doesn't need the typed count: run Step 8, then Step 10, and stop.

---

## Step 7 — Confirm

```
{n} object(s) will be PERMANENTLY DELETED:     ← Tag only: "Tag '{tag_name}' will be PERMANENTLY DELETED"

  Mode:              {mode}{" — root " + root_guid | " — tag " + tag_name}
  Org:               {org_name}
  Export TML first:  {"Yes, to " + export_directory if export_directory else "No — this is not reversible"}

Type the number of objects ({n}) to confirm deletion:     ← Tag only: type the tag name
  or P — preview only: list every target, export and delete nothing, and exit
```

On **P**, print the full `{targets}` list (every row, not just 15, with GUIDs), go to
Step 10, and stop. Nothing is exported or deleted.

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

A target goes into `{export_failed}` when its export call returns non-2xx, returns an
empty array, or returns an element with `status_code: "ERROR"` (cs_tools treats all
three as errors). If `{export_only}` is set, report how many were exported and which
failed, go to Step 10, and stop. Otherwise, if that list is non-empty, show it and ask:

```
{k} object(s) could not be exported. Delete them anyway (no restore path)? (Y / N):
```

On N, remove them from `{targets}`.

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
2. `LOGICAL_TABLE` objects that are Models/Worksheets/Views: subtype `WORKSHEET`,
   `MODEL`, `AGGR_WORKSHEET` (View) or `SQL_VIEW`
3. remaining `LOGICAL_TABLE` objects (Tables): subtype `ONE_TO_ONE_LOGICAL`,
   `USER_DEFINED` (CSV upload), or any other or unknown value
4. `CONNECTION`

If an object's type or subtype is missing, put it in tier 3. The retry rounds below
cover any ordering mistake.

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
success, re-check before treating it as a failure. Then go to Step 10.

---

## Step 10 — Report (optional)

Runs after Step 9, after an export-only run, or after a preview-only stop.

```
Write a CSV report of this run? (Y / N)
  If Y: file path (default ./deleter_report.csv):
```

Use cs_tools' `deleter_report` columns plus a status column: `type`, `guid`, `modified`,
`reported_at`, `author_guid`, `author`, `name`, `status`. See
[references/api-shapes.md](references/api-shapes.md) for the values. With a shell tool,
write the file and say where. Without one, print the CSV in a code block and say plainly
that nothing was written to disk.

---

## Error Handling

| Symptom                                                | Action                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Session lookup returns 401/403                         | Session expired or invalid. Ask the user to reconnect the Spotter Code MCP server (`/mcp`)                                           |
| Downstream search returns nothing for a known GUID     | Likely the wrong Org, or the object is a Connection whose dependents need the per-table path (Step 4). Never delete the root instead |
| Tag not found                                          | Tag names are case-sensitive. Report it and re-ask                                                                                   |
| A type, page, table or GUID batch fails to fetch       | Name it, mark the preview partial, and ask before continuing (Step 4). Never continue silently                                       |
| Delete returns 403 for some objects                    | The user doesn't own them and isn't an admin. List them in the failure report. Don't retry past the round limit                      |
| Delete keeps failing on a data object                  | Something outside `{targets}` still depends on it. Report it. Don't widen the target set without a new preview and confirmation      |
| Typed confirmation doesn't match                       | Stop. Delete nothing                                                                                                                 |
| `get-rest-api-reference` has no entry for an operation | Stop and name the operation that couldn't be resolved. Never guess a path or shape                                                   |

---

## Changelog

| Version | Date       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.2.0   | 2026-10-07 | GUID-list lookup batches 25 per call with a record size, and retries missing GUIDs as Connections. Tag lookup falls back to metadata search. Failed fetches are reported and need a choice to continue. Untyped objects delete in the Table tier. Adds preview only, a clearer export-only path and an optional CSV report. Differences from cs_tools: export runs after confirmation; failed exports pause; deletes are tiered with a failure report; the typed count is always required (no `--no-prompt`); no `--org` switch (the token must be scoped to the Org); GUIDs are looked up before deleting (from-tabular deleted blindly); the tag-only delete result is checked; an empty tag stops the run; a CSV report replaces the syncer; export only requires a directory in every mode |
| 1.1.0   | 2026-10-07 | Stops with one fixed message when the SpotterCode MCP tools are unavailable, instead of reporting server names, errors or auth config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.0.0   | 2026-09-24 | Ported from the cs_tools `bulk-deleter` CLI tool (downstream, from-tag, from-tabular) to REST API v2. Tag-only is its own mode. Confirmation is always required. Avoids two source crashes: from-tag declared its GUID set as `{}` (a dict), and downstream failed on an empty search result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
