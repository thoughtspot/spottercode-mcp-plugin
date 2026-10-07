---
name: ts-content-archive
description: Archive stale ThoughtSpot content — identify unused Answers and Liveboards from usage data and tag them for review (INACTIVE by default), untag them, or delete the ones still carrying that review tag after the review window, with explicit confirmation — using the ThoughtSpot REST API v2 directly.
compatibility: Requires ThoughtSpot instance with an ADMINISTRATION-privileged user; the TS: BI Server system worksheet must be queryable.
metadata:
  author: thoughtspot
  version: "1.0"
allowed-tools: execute-thoughtspot-code get-rest-api-reference Bash
---

# ThoughtSpot: Archive Stale Content

Find Answers and Liveboards nobody has queried or edited recently, and tag them
`INACTIVE` (or a name of your choosing) for a review window. Then delete the ones still
tagged once that window has passed. Tagging and deletion are always two separate runs of
this skill, with a human decision in between.

This skill follows the cs_tools `archiver` tool (`identify`, `untag`, `remove`) and
calls the ThoughtSpot REST API v2.0 directly. It gathers query activity from
`TS: BI Server` and modification metadata, filters to what's stale, tags it, lets the
user review, then exports and deletes on a second pass.

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

---

## References

| File                                                               | Purpose                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [scripts/filter_stale_content.ts](scripts/filter_stale_content.ts) | Deterministic staleness filter. Run it in Step 5 instead of reasoning over rows by hand           |
| [references/api-shapes.md](references/api-shapes.md)               | REST v2.0 request/response fields and payload shapes, including the exact BI Server query strings |
| [references/open-items.md](references/open-items.md)               | Behaviour not yet verified against a live instance, and its status                                |
| [assets/sample-filter-input.json](assets/sample-filter-input.json) | Worked example of Step 5's filter input: one survivor, three exclusions, one per staleness rule   |

---

## Prerequisites

- A valid bearer token for the target instance, for a user with `ADMINISTRATION`
  privilege (verified fresh in Step 1, every run). Archival is refused otherwise. If
  Orgs are enabled, the token must already be scoped to the target Org.
- The `TS: BI Server` system worksheet must be queryable from that Org. It holds the
  query activity history this skill filters on.
- A way to run `scripts/filter_stale_content.ts`: a shell with Node (`npx tsx`, listed as
  `Bash` in `allowed-tools`), or `execute-thoughtspot-code` with the function pasted in
  (path B in the script header). A shell is also needed to write exported TML files.

---

## Step 0 — Overview

On skill invocation, display this plan before doing any work:

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
7.  Confirm .......................................... you confirm (checkpoint)
8.  Apply (tag, untag, or export+delete) ............. auto

Confirmation required: Step 2, Step 3, and the checkpoint in Step 7.
Auto-executed: Steps 1, 4, 5, 6, 8.
Reversible: Identify (tagging) is fully reversible with Untag. Remove (deletion) is NOT
reversible unless you export TML first.

Ready to start? \[Y / N] — do not begin Step 1 until the user confirms.

---

## Step 1 — Preflight: Session, Permissions, Compatibility

Check every `compatibility` requirement before asking the user anything, on every run.

**1a. Operations.** Resolve each call with `get-rest-api-reference`: get current user
info, search metadata/data/users/groups, create/assign/unassign/delete tag, export
metadata TML, delete metadata. If any is missing, stop and name it. Never guess a path.

**1b. ADMINISTRATION.** A hard gate: a valid token only proves the token is valid, not
that this user may bulk tag/delete. Call **get current user info**.

- **Non-2xx** (401/403/expired token): stop with `Could not verify your ThoughtSpot
session ({status_code}). Re-authenticate and try again.`
- **2xx**: check the top-level `privileges` array for the exact string `ADMINISTRATION`.
  Never infer admin status from the username, groups or any other field.
- **Absent**: stop, with no reduced mode: `This account lacks ADMINISTRATION privilege.
Archival requires an administrator. Ask one to run this, or update your privileges.`

**Orgs.** No Org switch. Save `current_org.name` as `{org_name}` and state: `Archival
only affects Org "{org_name}". For another Org, re-run with a token scoped to it.`

**1c. TS: BI Server.** **search metadata** for `LOGICAL_TABLE`, `name_pattern: "TS: BI
Server"`; keep the exact-name match as `{ts_bi_server_guid}`. **search data** on it with
`min [Timestamp]` (save as `{bi_server_min_ts}`) to prove it's queryable in `{org_name}`,
never via a Primary Org token (tag/delete would hit it). If either fails, offer only
modes 2 and 3 (see Error Handling). Then print: `Preflight passed: {org_name},
ADMINISTRATION, operations resolved, TS: BI Server {"queryable" | "unavailable"}.`

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
```

Save `{tag_name}`, `{content_types}` (`["ANSWER"]`, `["LIVEBOARD"]`, or both),
`{recent_activity_days}`, `{recent_modified_days}`, `{ignore_tags}`, `{only_authors}`,
`{ignore_authors}`, `{only_groups}`, and `{ignore_groups}`.

**Within each pair, `{only_*}` and `{ignore_*}` are mutually exclusive.** If the user
gives both for authors, or both for groups, stop and ask them to pick one per pair. The
two pairs (individual vs. group) combine freely. For example, "only Aditya, excluding
the Contractors group" is valid. **System accounts are always excluded.** Content
authored by `tsadmin`, `system` or other built-in service accounts is never a
candidate, whatever the other filters say. (cs_tools documents this rule but never
applies it. This skill does.)

---

### Step 4 — Gather Activity and Metadata

**4a. Lookback window.** `{ts_bi_server_guid}` was resolved in Step 1c. If the user left
`{recent_activity_days}` blank, set it to the number of days between `{bi_server_min_ts}`
and today, plus one.

**4b. Fetch query activity in 7-day windows.** TS: BI Server can be large, so don't make
one unbounded call. Walk from `{recent_activity_days}` days ago to today in steps of 7:
each window runs from `{beg}` days ago up to `{end}` days ago. Run up to 4 windows at a
time.

For each window, call **search data** with the exact query string from
[references/api-shapes.md](references/api-shapes.md):

```
[user action] != [user action].answer_unsaved [answer book guid] != '{null}' [answer book guid] [timestamp] >= '{beg} days ago' [timestamp] < '{end} days ago'
```

If Orgs are enabled, insert ` [Org Name].'{org_name}'` before the timestamp tokens. Page
each window with `record_offset` until `data_rows` is shorter than `record_size`.
Collect every distinct `Answer Book GUID` across all windows into `{active_guids}`. This
is the content that has recent activity, which is excluded from staleness. The first
clause drops unsaved ad-hoc searches. The second drops rows with no content GUID.

**4c. Fetch content metadata.** Call **search metadata** once per type in
`{content_types}`, with `include_headers: true`. Paginate with `record_offset` until a
page is shorter than `record_size`. Map each element as described in api-shapes.md
(`metadata_id` → `guid`, `metadata_header.modified` → `modifiedEpochMs`, and so on).

---

### Step 5 — Filter to Stale Content

This is a deterministic transform over what may be thousands of rows. Don't reason over
it row by row, and don't reimplement its logic from memory. **Always run the script,
even for a handful of candidates.** Filtering by hand silently skips the ignore-tag and
system-account checks.

```
npx tsx scripts/filter_stale_content.ts < input.json
```

Without a shell, paste `filterStaleContent` into `execute-thoughtspot-code` and call it
(path B in the script header). If neither is available, say so rather than filtering by
hand. See [assets/sample-filter-input.json](assets/sample-filter-input.json) for a
worked example.

Build the input as documented in the script's header comment:

`todayEpochMs` (now), `activeGuids` (Step 4b), `metadata` (Step 4c),
`recentModifiedDays`, `systemAuthorGuids`, `ignoreTags` (the names in `{ignore_tags}`, or
`null`), and the four author/group GUID sets (`null` when not supplied).

Resolve names to GUIDs first:

- **Authors** (`{only_authors}`/`{ignore_authors}`): call **search users** for each
  name or email. Collect each match's `id` into `onlyAuthorGuids`/`ignoreAuthorGuids`.
- **Groups** (`{only_groups}`/`{ignore_groups}`): call **search groups** for each group,
  with `include_users: true`. cs_tools counts both direct and inherited members, so
  take the union of `users` over the group and every group reachable through its
  `sub_groups`, recursively. Collect the ids into `onlyGroupAuthorGuids` or
  `ignoreGroupAuthorGuids`. If a named group isn't found, or has no members, stop and
  re-ask. Group names are case-sensitive.
- **System accounts** (`tsadmin`, `system`, and similar built-ins): resolve their ids
  once via **search users** into `systemAuthorGuids`.

Parse the result: `{"filtered": [...], "count": n, "_ranVia": "..."}`, sorted
newest-modified first. Save `filtered` as `{filtered}`. `_ranVia` only appears if the
real script ran. If asked to confirm that, quote it back verbatim, or say plainly that
it is absent.

If `{filtered}` is empty, say `No stale content found matching your criteria.` and stop.

---

### Step 6 — Preview Candidates

Show up to 15 rows, in the script's order (most recently modified first):

```
{n} object(s) will be tagged '{tag_name}':

  TYPE       NAME                          AUTHOR          MODIFIED
  ─────────  ────────────────────────────  ──────────────  ─────────────
  LIVEBOARD  Q3 Exploratory Dashboard       jane.doe        142 days ago
  ANSWER     ad-hoc churn check             john.smith      210 days ago
  ...

{"(+n more not shown)" if n > 15}
```

AUTHOR is `authorName`, or the author GUID when the name is missing.

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

Proceed? (Y / N):
```

If N (the equivalent of cs_tools' `--dry-run`), ask what to change and go to Step 3.

---

### Step 8 — Apply Tag

Only run this step after a Y in Step 7 on this same run.

Call **create tag** with `{name: tag_name, color: "#A020F0"}`. An "already exists" error
means reuse the existing tag. Then call **assign tag** with
`metadata: [{identifier, type}, ...]` and `tag_identifiers: [tag_name]`, in batches of
up to 100 objects. See [references/api-shapes.md](references/api-shapes.md) for both
shapes.

```
Tagged {n} object(s) with '{tag_name}'.

Recommended next steps:
  1. Notify affected users. Give at least a 2-week window, and tell them how to
     remove the tag if they want to keep something.
  2. After the review window, run this skill again with mode 'Remove' to
     permanently delete whatever still carries the tag.
```

---

## Untag Flow

### Step 3 — Collect Tag Name and Look It Up

```
Tag name to remove [INACTIVE]:
```

Call **search metadata** for type `TAG` with that name, and match it case-insensitively,
as cs_tools does. If there is no match, report `No tag found with the name '{input}'.`
and stop. Save the matched tag's real `metadata_name` as `{tag_name}`, so Step 4 matches
its exact casing.

---

### Step 4 — Gather Tagged Content

Call **search metadata** for types `ANSWER` and `LIVEBOARD`, with
`tag_identifiers: [tag_name]` and headers included. Paginate as needed. Keep only
elements whose `metadata_header.tags` really contain `{tag_name}`, and save them as
`{filtered}`.

If `{filtered}` is empty, say `No content currently carries the '{tag_name}' tag.` and
stop.

---

### Step 5 — Confirm

```
This removes the '{tag_name}' tag from {n} Answer(s)/Liveboard(s).
Objects are not deleted. Only the tag association is removed. The tag itself
stays defined and can be reused later.

Proceed? (Y / N):
```

cs_tools' `untag` deletes the tag itself. This skill only unassigns it, so the tag stays
available for the next Identify run.

---

### Step 6 — Apply

Only run this step after a Y in Step 5 on this same run. Call **unassign tag** with
`metadata: [{identifier, type}, ...]` and `tag_identifiers: [tag_name]`, in batches of
up to 100.

`Removed '{tag_name}' from {n} object(s). They have been opted back in.`

---

## Remove Flow

**This is the destructive step.** Everything above it exists to make sure only
deliberately reviewed content reaches here.

### Step 3 — Collect Options

```
Tag name identifying content to remove [INACTIVE]:

Export TML before deleting? (Y / N) — strongly recommended, gives you a restore path
  If Y: which local directory should exports be saved to?
  If Y: export only, without deleting? (Y / N)
```

Save `{tag_name}`, `{export_directory}` (or none) and `{export_only}`. Export-only needs
a directory. (cs_tools silently exports nothing without one.)

---

### Step 4 — Gather Tagged Content

Same as Untag Step 4: search `ANSWER` and `LIVEBOARD` with
`tag_identifiers: [tag_name]`, then keep only elements whose tags contain `{tag_name}`
exactly. Save them as `{filtered}`. Also save that tag's `id` from any element's
`metadata_header.tags` as `{tag_id}`.

If `{filtered}` is empty, say `No content currently carries the '{tag_name}' tag.` and
stop.

---

### Step 5 — Preview

Same table format as Identify Step 6, drawn from `{filtered}`, most recently modified
first.

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

For deletion, require the exact count typed back, not just Y/N. This is the most
severe action this skill can take, and a mistyped `Y` should not trigger it. If the
typed value doesn't match `{n}`, stop without deleting.

---

### Step 7 — Export (if requested)

Only run this step after the Step 6 confirmation. Call **export metadata TML** for each
object in `{filtered}`, one per call, up to 4 at a time. Write each `edoc` to
`{export_directory}/{info.type}/{guid}.{info.type}.tml` with your shell tool. That is
the cs_tools layout. Without a shell tool, hand each file's path and content to the
consumer, and say plainly that nothing was written to disk.

Objects whose export response has `status_code: "ERROR"` go into `{export_failed}`. If
there are any:

```
{k} object(s) could not be exported. Delete them anyway (no restore path)? (Y / N):
```

On N, drop them from `{filtered}`. If `{export_only}`, report
`Exported {n - k} object(s) to {export_directory}.` and stop.

---

### Step 8 — Delete

This step performs the permanent deletion confirmed in Step 6. Don't reach it without
that confirmation on this same run.

Call **delete metadata** with `metadata: [{identifier: guid}]` for each object in
`{filtered}`, one per call, up to 15 at a time. Then, as cs_tools does, delete the tag
itself: call **delete tag** with `{tag_id}`. Only do that once every object delete has
succeeded. If any object failed, keep the tag, so the failures can be retried with
another Remove run.

```
Deleted {deleted} of {n} object(s) previously tagged '{tag_name}'.
{"Deleted tag '" + tag_name + "'." if tag deleted else "Kept tag '" + tag_name + "' because some deletes failed."}
{"TML exported to " + export_directory if export_directory else ""}
{list of failures with their error messages, if any}
```

---

## Error Handling

| Symptom                                                                               | Action                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session lookup returns 401, or user lacks `ADMINISTRATION`                            | 401: the bearer token expired, and the consumer must re-authenticate. No `ADMINISTRATION`: stop immediately, because archival is admin-only                                                                                                                                                      |
| Both only/ignore given for authors or groups, or a group name isn't found             | Both given: stop, and ask the user to pick one. Not found or empty: report and re-ask (group names are case-sensitive)                                                                                                                                                                           |
| TS: BI Server not found or not queryable                                              | Identify only: stop. This skill can't determine activity without it, so never guess staleness from modification date alone. In a non-Primary Org, report that this Org is unsupported (open item 1). Never switch to a Primary Org token, because tagging and deletion would hit the Primary Org |
| An activity search times out on a window                                              | Narrow the window (for example 3 days instead of 7) and retry that window only                                                                                                                                                                                                                   |
| Create tag reports the tag already exists, or an object is still visible after Remove | Tag exists: not an error, reuse it. Deletion can take a moment to propagate, so re-check before escalating                                                                                                                                                                                       |
| Remove: the typed count doesn't match `{n}`                                           | Stop. Delete nothing. Re-show the preview and ask again                                                                                                                                                                                                                                          |
| `get-rest-api-reference` has no entry for an operation described here                 | Stop, and name the operation that couldn't be resolved. Never guess a path or shape                                                                                                                                                                                                              |

---

## Changelog

| Version | Date       | Summary                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.2     | 2026-09-28 | Step 1 is a preflight: resolves every operation, checks ADMINISTRATION, and checks TS: BI Server is queryable before any questions. Without BI Server, only Untag and Remove are offered                                                                                                                                                                                  |
| 1.1     | 2026-09-24 | Payloads moved from v2-beta fields to REST v2.0, matching cs_tools. Exact BI Server query. Org-name filter. Nested groups. Several ignore tags. Remove adds export-only, writes TML files, keeps objects that failed to export, and deletes the tag as cs_tools does. Not ported: `--no-prompt` (confirmation is always required) and the syncer `archiver_report` output |
| 1.0     | 2026-09-16 | Initial port of the cs_tools `archiver` tool                                                                                                                                                                                                                                                                                                                              |
