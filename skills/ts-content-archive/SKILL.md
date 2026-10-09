---
name: ts-content-archive
description: Archive stale ThoughtSpot content — identify unused Answers and Liveboards from usage data and tag them for review (INACTIVE by default), untag them, or delete the ones still carrying that review tag after the review window, with explicit confirmation — using the ThoughtSpot REST API v2 directly.
compatibility: Requires ThoughtSpot instance with an ADMINISTRATION-privileged user; the TS: BI Server system worksheet must be queryable.
metadata:
  author: thoughtspot
  version: "1.4"
allowed-tools: execute-thoughtspot-code get-rest-api-reference Bash
---

# ThoughtSpot: Archive Stale Content

Find Answers and Liveboards nobody has queried or edited recently, and tag them
`INACTIVE` (or a name of your choosing) for a review window. Then delete the ones still
tagged once that window has passed. Tagging and deletion are always two separate runs of
this skill, with a human decision in between.

This skill follows the cs_tools `archiver` tool (`identify`, `untag`, `remove`) and
calls the ThoughtSpot REST API v2.0 directly, using `TS: BI Server` query activity and
modification metadata to decide what's stale.

**The thing to understand before starting:** Identify only ever tags. It never deletes.
Deletion is a separate mode that only acts on content still carrying the review tag.
That gives users a window to untag content they want to keep.

Ask one question at a time for **dependent** decisions. Batch **independent**
questions into a single prompt to cut round-trips.

**Before every call, resolve the operation and its exact path/shape with
`get-rest-api-reference`. Do not trust a remembered path.** The operation names and
payload shapes in [references/api-shapes.md](references/api-shapes.md) are the REST
v2.0 contract that cs_tools uses. This document deliberately does not print paths. Once
an operation is resolved, use `execute-thoughtspot-code` to make the call.

**Tools check, before anything else (Step 0 included).** Make one `get-rest-api-reference`
call. The tools may carry a server prefix (`mcp__<server>__…`) or need loading first. If
either tool can't be found, its server failed to connect, or the call is rejected for
authentication, reply with only this message and stop:

> This skill needs the ThoughtSpot Spotter Code MCP server, which isn't connected. Connect it in your MCP client, then try again.

Don't name servers, quote errors or status codes, mention tokens, headers, OAuth or
config, or show any step.

---

## References

| File                                                               | Purpose                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [scripts/filter_stale_content.ts](scripts/filter_stale_content.ts) | Deterministic staleness filter. Run it in Step 5 instead of reasoning over rows by hand           |
| [references/api-shapes.md](references/api-shapes.md)               | REST v2.0 request/response fields and payload shapes, including the exact BI Server query strings |
| [references/modes.md](references/modes.md)                         | Mode details: name resolution, untag scopes, tag batch retry, TML export layout, CSV report       |
| [references/errors.md](references/errors.md)                       | Error handling: symptoms and what to do for each                                                  |
| [references/open-items.md](references/open-items.md)               | Behaviour not yet verified against a live instance, and its status                                |
| [references/changelog.md](references/changelog.md)                 | Version history and intentional differences from cs_tools                                         |
| [assets/sample-filter-input.json](assets/sample-filter-input.json) | Worked example of Step 5's filter input: one survivor, three exclusions, one per staleness rule   |

---

## Prerequisites

- A connected Spotter Code MCP server (it handles sign-in: never ask for a URL, token or
  credentials), signed in as an `ADMINISTRATION` user in the target Org (checked in Step 1).
- The `TS: BI Server` system worksheet, which holds query activity, queryable from that Org.
- A way to run `scripts/filter_stale_content.ts`: a shell with Node (`npx tsx`, `Bash`
  in `allowed-tools`), or `execute-thoughtspot-code` with the function pasted in (path
  B in the script header). A shell also writes TML exports and the optional CSV report.

---

## Step 0 — Overview

Once the tools check passes, display this plan before doing any other work:

---

**ts-content-archive**: find stale Answers and Liveboards, tag them for review, and
delete the ones still tagged after the review window.

Steps:

1.  Preflight (session, admin, compatibility) ........ auto
2.  Choose mode: Identify / Untag / Remove ........... you choose
3.  Collect selection criteria ....................... you choose
4.  Gather activity + metadata ....................... auto
5.  Filter to stale content .......................... auto
6.  Preview candidates ............................... auto
7.  Confirm (or preview only) ........................ you confirm (checkpoint)
8.  Apply (tag, untag, or export+delete) ............. auto

Confirmation required: Step 2, Step 3, and the checkpoint in Step 7.
Auto-executed: Steps 1, 4, 5, 6, 8.
Reversible: Identify (tagging) is reversible with Untag. Deleting the tag itself in
Untag, and deleting content in Remove, are NOT reversible (export TML first).

Ready to start? \[Y / N] — do not begin Step 1 until the user confirms.

---

## Step 1 — Preflight: Session, Permissions, Compatibility

Check every `compatibility` requirement before asking the user anything, on every run.

**1a. Operations.** Resolve each call with `get-rest-api-reference`: get current user
info, search metadata/data/users/groups/tags, create/assign/unassign/delete tag, export
metadata TML, delete metadata. If any is missing, stop and name it. Never guess a path.

**1b. ADMINISTRATION.** A hard gate (a valid session doesn't prove this user may bulk
tag/delete). Call **get current user info**.

- **Non-2xx** (401/403/expired token): stop with `Could not verify your ThoughtSpot
session ({status_code}). Reconnect the Spotter Code MCP server and try again.`
- **2xx**: check the top-level `privileges` array for the exact string `ADMINISTRATION`.
  Never infer admin status from the username, groups or any other field.
- **Absent**: stop, with no reduced mode: `This account lacks ADMINISTRATION privilege.
Archival requires an administrator. Ask one to run this, or update your privileges.`

**Orgs.** No Org switch. Save `current_org.name` as `{org_name}` and state: `Archival
only affects Org "{org_name}". For another Org, sign in to that Org and re-run.`

**1c. TS: BI Server.** **search metadata** for `LOGICAL_TABLE`, `name_pattern: "TS: BI
Server"`; keep the exact-name match as `{ts_bi_server_guid}`. **search data** on it with
`min [Timestamp]` (save the cell as `{bi_server_min_ts}`) to prove it's queryable in
`{org_name}`, never via a Primary Org token (tag/delete would hit it). If either fails,
offer only modes 2 and 3 (see [references/errors.md](references/errors.md)). Then print:
`Preflight passed: {org_name}, ADMINISTRATION, operations resolved, TS: BI Server {"queryable" | "unavailable"}.`

---

## Step 2 — Choose Mode

```
What would you like to do?

  1  Identify — find stale content and tag it for review
  2  Untag    — remove the review tag from everything that has it (opt everyone back in)
  3  Remove   — permanently delete content that still carries the review tag

Enter 1, 2, or 3:
```

Save `{mode}` and jump to its section (nothing changes before that flow's confirm step):

- 1 → [Identify Flow](#identify-flow)
- 2 → [Untag Flow](#untag-flow)
- 3 → [Remove Flow](#remove-flow)

---

## Identify Flow

### Step 3 — Collect Selection Criteria

Ask, batching independent questions into one prompt:

```
Tag name to apply to stale content [INACTIVE]:

Content type to scan:
  1  Answers and Liveboards (both)
  2  Answers only
  3  Liveboards only

Inactivity threshold. Content is flagged only if BOTH conditions hold:
  - No query activity in the last N days
  - No modification (edit/save) in the last M days

  Days without query activity (N) [default: full TS: BI Server history]:
  Days without modification (M) [100]:

Exclude content that carries any of these tags? (comma-separated names, or blank):
Restrict/exclude by individual author(s)? (restrict-to or exclude, names/emails, or blank):
Restrict/exclude by group(s)? (restrict-to or exclude, comma-separated names, or blank):
Write a CSV report of the candidates? (file path, or blank for none):
```

Save `{tag_name}`, `{content_types}` (`["ANSWER"]`, `["LIVEBOARD"]`, or both),
`{recent_activity_days}`, `{recent_modified_days}`, `{ignore_tags}`, `{only_authors}`,
`{ignore_authors}`, `{only_groups}`, `{ignore_groups}`, and `{report_path}`.

**Within each pair, `{only_*}` and `{ignore_*}` are mutually exclusive.** If both are
given for authors or for groups, stop and ask for one per pair. The two pairs combine
freely ("only Aditya, excluding the Contractors group" is valid). **System accounts are
always excluded:** content authored by exactly `tsadmin`, `system` or `su` is never a
candidate (an intentional difference: cs_tools documents this but never applies it).

---

### Step 4 — Gather Activity and Metadata

**4a. Lookback window.** If the user left `{recent_activity_days}` blank, derive it from `{bi_server_min_ts}`, the single cell of
`contents[0].data_rows[0][0]`. In `COMPACT` format a timestamp cell is wrapped as
`{"v": {"s": <value>}}`. Unwrap it to `.v.s` (a bare number is used as is). The value is
epoch **seconds** (cs_tools casts it with `datetime.fromtimestamp`). As a guard, treat
any value > 1e12 as milliseconds and divide by 1000. Then:
`{recent_activity_days} = floor((now_epoch_s - min_epoch_s) / 86400) + 1`.

**4b. Fetch query activity in 7-day windows** (never one unbounded call). Walk from
`{recent_activity_days}` days ago to today in steps of 7, up to 4 windows at a time. For
each window (`{beg}` to `{end}` days ago), call **search data** with the exact query
string from [references/api-shapes.md](references/api-shapes.md):

```
[user action] != [user action].answer_unsaved [answer book guid] != '{null}' [answer book guid] [timestamp] >= '{beg} days ago' [timestamp] < '{end} days ago'
```

If Orgs are enabled, insert ` [Org Name].'{org_name}'` before the timestamp tokens. Page
each window with `record_offset` until `data_rows` is shorter than `record_size`.
Collect every distinct `Answer Book GUID` into `{active_guids}` (content with recent
activity, excluded from staleness). Never continue with a missing window: missing
activity makes active content look stale.

**4c. Fetch content metadata.** Call **search metadata** once per type in
`{content_types}`, with `include_headers: true`. Paginate with `record_offset` until a
page is shorter than `record_size`. Map each element as described in api-shapes.md
(`metadata_id` → `guid`, `metadata_header.modified` → `modifiedEpochMs`, and so on).

If a page fails, report which type and page failed and ask:
`Fetching {type} failed at record_offset {offset} ({error}). Continue with the {k} objects fetched so far (preview marked PARTIAL), or stop? (C / S):`
On C, set `{partial} = true`; on S, stop with no changes.

---

### Step 5 — Filter to Stale Content

A deterministic transform over what may be thousands of rows. Don't reason over rows or
reimplement it from memory. **Always run the script, even for a handful of
candidates.** Filtering by hand silently skips the ignore-tag and system-account checks.

```
npx tsx scripts/filter_stale_content.ts < input.json
```

Without a shell, paste `filterStaleContent` into `execute-thoughtspot-code` (path B in
the script header). If neither works, say so; never filter by hand. Worked example:
[assets/sample-filter-input.json](assets/sample-filter-input.json).

Build the input as documented in the script's header comment: `todayEpochMs` (now),
`activeGuids` (4b), `metadata` (4c), `recentModifiedDays`, `systemAuthorGuids`,
`ignoreTags` (`{ignore_tags}` names, or `null`), and the four author/group GUID sets
(`null` when not supplied). First resolve author, group (with nested sub-groups) and
system-account (`tsadmin`, `system`, `su`) names to GUIDs exactly as in
[references/modes.md](references/modes.md#resolving-filter-names). If a named group
isn't found or has no members, stop and re-ask (group names are case-sensitive).

Parse `{"filtered": [...], "count": n, "_ranVia": "..."}` (newest-modified first) and
save `filtered` as `{filtered}`. `_ranVia` only appears if the real script ran; if asked,
quote it back verbatim, or say plainly that it is absent.

If `{filtered}` is empty, say `No stale content found matching your criteria.` and stop.

---

### Step 6 — Preview Candidates

Show up to 15 rows, in the script's order (most recently modified first):

```
{n} object(s) will be tagged '{tag_name}'{" (PARTIAL: some metadata could not be fetched)" if partial}:

  TYPE       NAME                          AUTHOR          MODIFIED
  ─────────  ────────────────────────────  ──────────────  ─────────────
  LIVEBOARD  Q3 Exploratory Dashboard       jane.doe        142 days ago
  ANSWER     ad-hoc churn check             john.smith      210 days ago
  ...

{"(+n more not shown)" if n > 15}
```

AUTHOR is `authorName`, or the author GUID when missing. If `{report_path}` is set,
write the [CSV report](references/modes.md#csv-report) for all `{filtered}` rows with
`operation` `IDENTIFY` now, before the confirm, as cs_tools does.

---

### Step 7 — Confirm

```
Ready to tag {n} object(s) with '{tag_name}':

  Org:                {org_name}
  Content types:      {content_types}
  Query inactivity:   {recent_activity_days}+ days
  Modification age:   {recent_modified_days}+ days
  Ignore tags:        {ignore_tags or "none"}
  Author filter:      {only_authors or ignore_authors or "none"}
  Group filter:       {only_groups or ignore_groups or "none"}

This only tags content. Nothing is deleted. Tagged content can be reviewed and
untagged by its owner, or removed later with a separate 'Remove' run.

  Y  Proceed and tag
  N  Change the criteria
  P  Preview only — exit without tagging (dry run)

Enter Y, N, or P:
```

On N, ask what to change and go to Step 3. On P (cs_tools' `--dry-run`), say `Preview
only. Nothing was tagged.` and stop.

---

### Step 8 — Apply Tag

Only run this step after a Y in Step 7 on this same run.

Call **create tag** with `{name: tag_name, color: "#A020F0"}` ("already exists" means
reuse it). Then call **assign tag** with `metadata: [{identifier, type}, ...]` and
`tag_identifiers: [tag_name]`, in batches of up to 100 objects. If a batch errors, retry it one object per call and collect what
still fails as `{failed}` ([details](references/modes.md#batch-failures)).

```
Tagged {n - len(failed)} of {n} object(s) with '{tag_name}'.
{list of failures with their error messages, if any}

Recommended next steps:
  1. Notify affected users. Give at least a 2-week window, and tell them how to
     remove the tag to keep something.
  2. After the window, run this skill with mode 'Remove' to delete what's still tagged.
```

---

## Untag Flow

### Step 3 — Collect Tag Name and Scope

```
Tag name to remove [INACTIVE]:

How should it be removed?
  a  Unassign it from Answers and Liveboards only; keep the tag defined for reuse
  b  Delete the tag entirely (cs_tools behaviour). This removes it from EVERY object
     type, including Tables and Models, and cannot be undone (you confirm in Step 5)

Enter a or b:
```

Call **search tags** and match the name case-insensitively, as cs_tools does. No match:
report `No tag found with the name '{input}'.` and stop. Save the matched tag's real
name as `{tag_name}`, its id as `{tag_id}`, and the choice as `{untag_scope}`.

---

### Step 4 — Gather Tagged Content

**search metadata** for `ANSWER` and `LIVEBOARD` with `tag_identifiers: [tag_name]` and
headers, paginating (a failed page: as in Identify 4c). Keep only elements whose
`metadata_header.tags` really contain `{tag_name}`, as `{filtered}`.

If `{filtered}` is empty: for `a`, say `No content currently carries the '{tag_name}'
tag.` and stop; for `b`, continue, since the tag may sit on other object types.

---

### Step 5 — Confirm

For `a`:

```
This removes the '{tag_name}' tag from {n} Answer(s)/Liveboard(s). Nothing is
deleted; the tag itself stays defined and can be reused later.

Proceed? (Y / N):
```

For `b`:

```
This PERMANENTLY DELETES the tag '{tag_name}'. It disappears from {n} Answer(s)/
Liveboard(s) and from every other object that carries it. No object is deleted, but
the tag and all its assignments cannot be restored.

Type the tag name ({tag_name}) to confirm deletion:
```

If the typed name doesn't match exactly, stop without deleting.

---

### Step 6 — Apply

Only run this step after the Step 5 confirmation on this same run.

- `a`: call **unassign tag** (same shape and 100-object batches as Identify Step 8,
  including the one-per-call retry of a failed batch).
  `Removed '{tag_name}' from {n - len(failed)} of {n} object(s). They have been opted back in.`
- `b`: delete the tag `{tag_id}` with **delete metadata**, as cs_tools does, falling
  back to [**delete tag**](references/modes.md#deleting-the-tag) if that is rejected.
  `Deleted tag '{tag_name}'. It no longer appears on any object.` List any failures.

---

## Remove Flow

**This is the destructive step.** Everything above it exists to make sure only
deliberately reviewed content reaches here.

### Step 3 — Collect Options

```
Tag name identifying content to remove [INACTIVE]:

What should this run do?
  1  Delete (optionally exporting TML first)
  2  Export TML only, delete nothing
  3  Preview only — list what would be deleted, then exit (dry run)

Export TML before deleting? (Y / N) — strongly recommended, gives you a restore path
  If Y, or option 2: which local directory should exports be saved to?
Write a CSV report of the tagged content? (file path, or blank for none):
```

Save `{tag_name}`, `{remove_action}`, `{export_directory}` (or none) and `{report_path}`.
Export-only needs a directory (cs_tools silently exports nothing without one).

---

### Step 4 — Gather Tagged Content

Same as Untag Step 4 (exact tag-name match, failed page handled as in Identify 4c; a
partial set only means fewer deletes, but mark the preview PARTIAL). Save the tag's `id`
from any element's `metadata_header.tags` as `{tag_id}`. If `{filtered}` is empty, say
`No content currently carries the '{tag_name}' tag.` and stop.

---

### Step 5 — Preview

Same table as Identify Step 6, from `{filtered}`. If `{report_path}` is set, write the
CSV report with `operation` `REMOVE`. If `{remove_action}` is 3 (cs_tools' `--dry-run`),
say `Preview only. Nothing was exported or deleted.` and stop.

---

### Step 6 — Confirm

For export-only:

```
{n} object(s) tagged '{tag_name}' will be exported to {export_directory}. Nothing is deleted.

Proceed? (Y / N):
```

Otherwise:

```
{n} object(s) tagged '{tag_name}' will be PERMANENTLY DELETED, and then the tag
'{tag_name}' itself will be deleted.

  Org:               {org_name}
  Export TML first:  {"Yes, to " + export_directory if export_directory else "No — this is not reversible"}

Type the number of objects ({n}) to confirm deletion:
```

For deletion, require the exact count typed back, not just Y/N: a mistyped `Y` must not
trigger the most severe action here. If it doesn't match `{n}`, stop without deleting.

---

### Step 7 — Export (if requested)

Only run this step after the Step 6 confirmation. Call **export metadata TML** for each
object in `{filtered}`, one per call, up to 4 at a time, and write each file in the
[cs_tools layout](references/modes.md#tml-export). Without a shell, hand each path and
content to the consumer, and say plainly that nothing was written to disk.

Objects whose export response has `status_code: "ERROR"` go into `{export_failed}`. If
there are any:

```
{k} object(s) could not be exported. Delete them anyway (no restore path)? (Y / N):
```

On N, drop them from `{filtered}`. If export-only, report
`Exported {n - k} object(s) to {export_directory}.` and stop.

---

### Step 8 — Delete

Performs the deletion confirmed in Step 6. Never reach it without that confirmation.

Call **delete metadata** with `metadata: [{identifier: guid}]` for each object in
`{filtered}`, one per call, up to 15 at a time. Then, as cs_tools does, delete the tag
itself with **delete metadata** on `{tag_id}` (fallback: **delete tag**). Only do that
once every object delete has succeeded. If any object failed, keep the tag, so the
failures can be retried with another Remove run.

```
Deleted {deleted} of {n} object(s) previously tagged '{tag_name}'.
{"Deleted tag '" + tag_name + "'." if tag deleted else "Kept tag '" + tag_name + "' because some deletes failed."}
{"TML exported to " + export_directory if export_directory else ""}
{list of failures with their error messages, if any}
```
