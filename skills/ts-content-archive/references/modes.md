# Mode Details

Detail for the Identify, Untag and Remove flows in [../SKILL.md](../SKILL.md). Operation
names only; resolve paths with `get-rest-api-reference`.

---

## Untag scopes

cs_tools `untag` looks the tag up with a tags search, matches the name
case-insensitively (`casefold`), and deletes the tag with a metadata delete on its GUID.
Deleting the tag strips it from every object type, not only Answers and Liveboards.

| Choice | What it does                                                                 | Reversible                                   |
| ------ | ---------------------------------------------------------------------------- | -------------------------------------------- |
| `a`    | Unassigns the tag from the Answers and Liveboards carrying it. The tag stays | Yes: run Identify again, or reassign the tag |
| `b`    | Deletes the tag (cs_tools behaviour). It disappears from every tagged object | No: the tag and all its assignments are gone |

Both choices use the same case-insensitive lookup. Save the matched tag's real name for
later steps, because `tag_identifiers` and the response re-check match it exactly.

`b` needs the tag name typed back to confirm. `a` needs a plain Y.

---

## Deleting the tag

Untag `b` and Remove Step 8 both delete the tag the way cs_tools does: **delete
metadata** with `{"metadata": [{"identifier": "{tag_id}"}]}`. If that call is rejected
(for example, the instance does not accept a TAG through delete metadata), fall back to
the **delete tag** operation with the same id. Report which one succeeded only if the
fallback was needed.

Remove deletes the tag only after every object delete has succeeded. cs_tools sends the
tag delete in the same concurrent batch as the object deletes. This skill keeps the tag
when any object fails, so the failures can be retried with another Remove run.

---

## Batch failures

Assign and unassign tag accept many objects per call. This skill sends up to 100 per
call (cs_tools sends one per call; see open item 3). If a batch call returns an error:

1. Don't fail the run. Retry that batch's objects one per call, up to 15 at a time.
2. Collect each object that still fails, with its `guid`, `name` and error message.
3. Report `{succeeded} of {n}` and list the failures. Never report the whole batch as
   failed when some objects succeeded on retry.

---

## TML export

Remove Step 7 writes each exported `edoc` to:

```
{export_directory}/{info.type}/{guid}.{info.type}.tml
```

That is the cs_tools layout. Treat an element with `info.status.status_code: "ERROR"` as
a failure even on HTTP 200.

---

## CSV report

Optional in Identify (Step 6) and Remove (Step 5). It mirrors the cs_tools
`archiver_report` syncer table (`models.ArchiverReport`). Columns, in this order:

| Column        | Value                                                |
| ------------- | ---------------------------------------------------- |
| `type`        | `ANSWER` or `LIVEBOARD`                              |
| `guid`        | Object GUID                                          |
| `modified`    | Last modified, ISO-8601 UTC (from `modifiedEpochMs`) |
| `reported_at` | When this run built the report, ISO-8601 UTC         |
| `author_guid` | Author's user GUID                                   |
| `author`      | Author's name (empty if missing)                     |
| `name`        | Object name                                          |
| `operation`   | `IDENTIFY` or `REMOVE`                               |

Write a header row, then one row per object in `{filtered}`, quoting any field that
contains a comma, quote or newline (RFC 4180). With `Bash` available, write the file to
`{report_path}` and print `Report written to {report_path} ({n} rows).` Without it,
print the CSV in a fenced code block and say plainly that no file was written.

The report is written at preview time, so a preview-only run still produces it, as
cs_tools does with `--dry-run`. Untag has no report (cs_tools `untag` has no syncer).

---

## Resolving filter names

Identify Step 5 turns the names collected in Step 3 into the GUID sets the filter script
takes:

- **Authors** (`{only_authors}`/`{ignore_authors}`): call **search users** for each
  name or email. Collect each match's `id` into `onlyAuthorGuids`/`ignoreAuthorGuids`.
- **Groups** (`{only_groups}`/`{ignore_groups}`): call **search groups** for each group,
  with `include_users: true`. cs_tools counts both direct and inherited members, so
  take the union of `users` over the group and every group reachable through its
  `sub_groups`, recursively, keeping a visited set. Collect the ids into
  `onlyGroupAuthorGuids` or `ignoreGroupAuthorGuids`. If a named group isn't found, or
  has no members, stop and re-ask. Group names are case-sensitive.
- **System accounts**: call **search users** once for each of exactly `tsadmin`,
  `system` and `su`, keeping only an exact name match and skipping any that don't exist.
  Put their ids in `systemAuthorGuids`. These are the three built-ins cs_tools reads from
  session info (`tsadmin_user_id`, `system_user_id`, `super_user_id`). The script also
  drops rows whose `authorName` is one of those three names (case-insensitive), so an
  unresolved id can't let one through. cs_tools' `identify` docstring promises this
  exclusion but never applies it; this skill applies it intentionally.
