---
name: ts-variable-timezone
description: Manage the ts_user_timezone template variable in ThoughtSpot — search current values, or set/remove timezone values at org or user level — using the ThoughtSpot REST API v2 directly.
compatibility: Requires a ThoughtSpot instance where the ts_user_timezone template variable already exists; the caller must be allowed to update template variable values.
metadata:
    author: thoughtspot
    version: '1.0'
allowed-tools: execute-thoughtspot-code get-rest-api-reference
---

# ThoughtSpot: Manage Timezone Variable

Manage values for the `ts_user_timezone` template variable. This variable controls the
timezone applied to date/time calculations for each org or user.

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

- A valid bearer token for the target instance. If Orgs are enabled, the token's user
  must be able to act in every Org you target.
- The `ts_user_timezone` variable must already exist on the cluster. This skill does
  not create it.

---

## Step 0 — Overview

On skill invocation, display this plan before doing any work:

---

**ts-variable-timezone**: view, set, or remove `ts_user_timezone` values per org or user.

Steps:

1.  Choose operation: Search / Set / Remove ........ you choose
2.  Timezone value (Set only) ...................... you choose
3.  Target org(s) .................................. you choose
4.  Org level or specific users .................... you choose
5.  Confirm ........................................ you confirm (checkpoint)
6.  Apply .......................................... auto
7.  Report ......................................... auto

Search is read-only and stops after Step 1. Set and Remove are reversible: re-run
with the previous value to restore it.

---

## Step 1 — Select Operation

```
What would you like to do with ts_user_timezone?

  1  Search — view current timezone values set for ts_user_timezone
  2  Set    — set (or overwrite) a timezone value for an org or user
  3  Remove — remove the timezone value for an org or user

Enter 1, 2, or 3:
```

- 1 → `{operation}` = `"search"`. Go to [Search Flow](#search-flow).
- 2 → `{operation}` = `"set"` (API operation `REPLACE`)
- 3 → `{operation}` = `"remove"` (API operation `REMOVE`. The current value is looked up
  in Step 6.)

---

## Search Flow

Call **search variables** with `ts_user_timezone` as the identifier and
`METADATA_AND_VALUES` as the response content (see
[references/api-shapes.md](references/api-shapes.md)). `data[0]` is the variable record.
Its `values` array holds the assignments.

Inspect one element before parsing. Whether the value field is `value` or
`assigned_values` is unverified (see [references/open-items.md](references/open-items.md)).

```
ts_user_timezone — current assignments on {instance}

  Org               Level   Principal          Timezone
  ────────────────  ──────  ─────────────────  ──────────────────
  Primary           org     —                  Asia/Kolkata
  Primary           user    guest1             America/New_York
  ...

Total: {n} assignment(s)
```

Level is `user` when `principal_type == "USER"`, otherwise `org`. Principal shows
`principal_identifier` for user-level rows and `—` for org-level rows.

If `values` is empty or missing: `No values are currently set for ts_user_timezone on
{instance}.` On API error, show the raw error message.

Stop after displaying results.

---

## Step 2 — Collect Timezone (Set only)

Skip for Remove. The current value is looked up in Step 6.

```
Timezone value (IANA format, e.g. Asia/Kolkata, America/New_York, Europe/London):
```

Validate the format: `Region/City` with at least one `/` (for example `Asia/Kolkata` or
`America/Argentina/Buenos_Aires`), or `UTC`. Common prefixes: `Africa`, `America`,
`Antarctica`, `Arctic`, `Asia`, `Atlantic`, `Australia`, `Europe`, `Indian`, `Pacific`,
`Etc`. If the value looks invalid:

```
"{value}" does not look like a valid IANA timezone (expected format: Region/City).
Common examples: Asia/Kolkata, America/New_York, Europe/London, Australia/Sydney.

Continue anyway? (Y / N):
```

Save `{timezone_value}`.

---

## Step 3 — Collect Org(s)

Call **search orgs** with status `ACTIVE`. Paginate with `record_offset` until a page
comes back shorter than `record_size`. The org-name field casing is unverified (`name`
or `orgName`), so inspect one element. Save all names as `{available_orgs}`.

**20 or fewer orgs**: show a numbered checklist and parse comma-separated numbers.

```
Which org(s) should this apply to? Enter numbers separated by commas (e.g. 1, 3):

  1  Primary
  2  Sales
  ...
```

**More than 20 orgs**: ask by name.

```
{n} orgs found. Enter org name(s), comma-separated (exact match required):
```

Validate each name against `{available_orgs}`. For a miss, list close matches
(`Org "{name}" not found. Did you mean: ...`) and re-ask until all names are valid.

If Orgs are not enabled on the instance, use the single org the search returns without
asking. Save `{org_identifiers}`.

---

## Step 4 — Collect Scope

```
Apply to:

  1  Org level          — applies to all users in the org(s)
  2  Specific user(s)   — search by name or email
  3  Users in a group   — find users via group membership

Enter 1, 2, or 3:
```

**1**: set `{level}` = `"org"`, and leave `{principal_identifiers}` empty.

**2 — Specific user(s)**: ask `Search for user (name or email pattern):`. Call
**search users** with that `name_pattern`, `{org_identifiers}`, and account status
`ACTIVE`. Paginate with `record_offset` until a page comes back shorter than
`record_size`. The display-name and email field casing is unverified, so inspect one
element (open item 4). Show `# | display name | name (email)`. If there are no results, say so and
re-ask. The user picks by number(s). Save the selected `name` values (the login name,
not the display name or email) as `{principal_identifiers}`. Set `{level}` = `"user"`.

**3 — Users in a group**: ask `Search for group (name pattern):`. Call **search groups**
with that `name_pattern`, `{org_identifiers}`, and `include_users: true`. Paginate the
same way as for users. Show `# | display name | user count`, deriving the count as `users.length`. The user picks
one group. Then list its users:

```
Users in "{group_name}":

  1  user@example.com
  2  another@example.com
  ...

Apply to all {n} users? (Y) or enter numbers to pick specific ones:
```

Save the selected `name` values as `{principal_identifiers}`. Set `{level}` = `"user"`.

---

## Step 5 — Confirm

Show a summary before making any change:

```
Ready to update ts_user_timezone:

  Operation:  {operation}
  Timezone:   {timezone_value}          ← omit for remove
  Orgs:       {org_identifiers, comma-separated}
  Level:      {level} level{" — users: " + principal_identifiers if level == "user"}
  Cluster:    {instance}

Proceed? (Y / N):
```

If N, ask what to change and return to the relevant step.

---

## Step 6 — Apply

Only run this step after a Y in Step 5 on this same run. Set and Remove both call
**update variable values**, with `ts_user_timezone` as the variable identifier. The
identifier goes in the **path**, URL-quoted, not in the body.

Build the assignment array as described in
[references/api-shapes.md](references/api-shapes.md):

- **Org level**: one entry per org, with no principal fields.
- **User level**: one entry per org × user pair.

**Set**: send `operation: "REPLACE"`, with `{timezone_value}` in every entry.

**Remove**: REMOVE needs the exact value currently assigned, not just the scope. First
call **search variables** (as in the Search Flow). Then, for each entry you built, find
the matching assignment in `data[0].values`:

- **User level**: `principal_type == "USER"`, and the same `org_identifier` and
  `principal_identifier`.
- **Org level**: `principal_type` absent or null, and the same `org_identifier`.

Put each match's own value into its entry. Values can differ between orgs and users, so
never reuse one value for every entry. Drop entries that have no current assignment, and
list them in the report. If no entries remain, report `No ts_user_timezone assignment
exists for the selected scope.` and stop. Otherwise send `operation: "REMOVE"`.

**Response**: HTTP 204 with an empty body means success. A JSON body with an `error` key
means failure. Extract its message.

---

## Step 7 — Report Result

On success:

```
ts_user_timezone updated.

  Operation:  {operation}
  Timezone:   {timezone_value}          ← omit for remove
  Orgs:       {org_identifiers, comma-separated}
  Applied at: {level} level{" — users: " + principal_identifiers if level == "user"}
  Skipped:    {entries with no current value, remove only, or "none"}
  Cluster:    {instance}
```

On error:

```
API call failed.

  Error: {error_message}

Common causes:
  - Timezone value is not recognised by ThoughtSpot (check IANA spelling)
  - Username does not exist in the specified org
  - Org name is incorrect (check exact capitalisation)
  - ts_user_timezone variable does not exist on this cluster
```

---

## Error Handling

| Symptom                                                | Action                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Any call returns 401                                   | Bearer token expired. The consumer must refresh or re-authenticate                                   |
| 404 on a variable operation                            | `ts_user_timezone` may not exist on this cluster. Ask an admin to create it                          |
| 400 mentioning `variable_assignment`                   | Malformed body. Check `operation` (REPLACE/REMOVE) and the entry shape in `references/api-shapes.md` |
| Timezone not applied after a successful update         | The user's existing ThoughtSpot session may hold stale state. Ask them to log out and back in        |
| `get-rest-api-reference` has no entry for an operation | Stop and name the operation that couldn't be resolved. Never guess a path or shape                   |

---

## Changelog

| Version | Date       | Summary                                                                                                                             |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-09-24 | Moved from thoughtspot-agent-skills (`ts` CLI based) to REST API v2. No profile/CLI dependency. Remove looks up the value per entry |
