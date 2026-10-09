# API Shapes

Field names and payload shapes this skill relies on, for REST API v2.0 (`api/rest/2.0`).
They follow the calls the cs_tools `archiver` tool makes (`cs_tools/api/client.py`);
where this skill differs (tag batching, the delete-tag fallback), the section says so.
Always resolve the exact operation and path with `get-rest-api-reference` before calling.
This file documents shapes, never paths.

Earlier versions of this file used the old v2 beta's camelCase fields (`tsObject`,
`batchNumber`, `namePattern`, `formatType`, `dataObjectId`, and delete by query
parameters). Those are not valid for REST v2.0. Don't use them.

---

## Get current user info (Step 1)

Top-level fields used:

- `privileges`: array of strings. Check for the exact string `ADMINISTRATION`.
- `current_org`: `{id, name}`. `id` 0 is the Primary Org.
- `orgs`: `[{id, name}, ...]`.

---

## Search metadata (Steps 4a, 4c, and Untag/Remove Step 4)

```json
{
	"metadata": [{ "type": "LIVEBOARD" }],
	"include_headers": true,
	"record_offset": 0,
	"record_size": 500
}
```

- `metadata[].type`: `ANSWER`, `LIVEBOARD`, `LOGICAL_TABLE` (for the TS: BI Server
  worksheet, with `name_pattern: "TS: BI Server"`), or `TAG`. Add `name_pattern` to
  filter by name.
- `tag_identifiers: ["{tag_name}"]` restricts results to objects carrying that tag.
  Re-check the name exactly in the response, as cs_tools does.
- Paginate with `record_offset` until a page is shorter than `record_size`. Send one
  request per type.

Each response element:

- `metadata_id`, `metadata_name`, `metadata_type`
- `metadata_header.author`: the author's user GUID
- `metadata_header.authorName`: may be missing, so show the GUID then
- `metadata_header.tags`: `[{id, name, ...}]`
- `metadata_header.modified`: epoch milliseconds

Map these to the filter script's input as `guid`, `name`, `type`, `authorGuid`,
`authorName`, `tags`, and `modifiedEpochMs`.

---

## Search data (Steps 4a and 4b)

```json
{
	"logical_table_identifier": "{ts_bi_server_guid}",
	"query_string": "{search tokens}",
	"data_format": "COMPACT",
	"record_offset": 0,
	"record_size": 100000
}
```

Get `{ts_bi_server_guid}` from a metadata search for `LOGICAL_TABLE` named
`TS: BI Server`. The response is `contents[0]` with `column_names` and `data_rows`, where
each row is an array in `column_names` order. Page with `record_offset` until
`data_rows` is shorter than `record_size`. `COMPACT` keeps null values that `FULL` drops.

Query strings, exactly as cs_tools builds them:

- Earliest activity: `min [Timestamp]`, which returns column `Minimum Timestamp`. In
  `COMPACT` format its single cell (`data_rows[0][0]`) is wrapped as
  `{"v": {"s": <value>}}`; cs_tools unwraps it to `.v.s` (`_convert_compact_to_full`) and
  casts it with `datetime.fromtimestamp`, so the value is epoch **seconds**. Treat any
  value > 1e12 as milliseconds. Lookback days = `floor((now_s - min_s) / 86400) + 1`.
  On Software clusters with a non-UTC timezone, cs_tools relabels
  `fromtimestamp(tz=cluster)` as UTC without converting (`app.py` ~166), so its lookback
  can differ by a day; this raw-epoch formula is the intended, correct value.
- One activity window:
  `[user action] != [user action].answer_unsaved [answer book guid] != '{null}' [answer book guid] [timestamp] >= '{beg} days ago' [timestamp] < '{end} days ago'`.
  If Orgs are enabled, add ` [Org Name].'{org_name}'` before the timestamp tokens. The
  result column is `Answer Book GUID`.

Relative dates (`days ago`) are evaluated in the BI Server's timezone. On ThoughtSpot
Cloud that is UTC. On Software it is the cluster's timezone.

---

## Search groups (Step 5, group filters)

```json
{
	"group_identifier": "{group_name}",
	"include_users": true,
	"record_offset": 0,
	"record_size": 50
}
```

Each element has `id`, `name`, `users: [{id, name}]`, and `sub_groups: [{id, name}]`.
cs_tools counts both direct and inherited members. To match, take the union of `users`
over the group and every group reachable through `sub_groups`, recursively, keeping a
visited set. The field name `sub_groups` is open item 2 in
[open-items.md](open-items.md).

## Search users (Step 5, author filters and system accounts)

`{"user_identifier": "{name or email}"}` or `{"name_pattern": "%{term}%"}`. Each element
has `id` and `name`. Use `id` as the author GUID. For system accounts, look up exactly
`tsadmin`, `system` and `su` by `user_identifier` and keep only an exact name match.

---

## Tags (Identify Step 8, Untag Steps 3 and 6, Remove Step 8)

- **Search tags** (Untag Step 3): returns `[{id, name, ...}]`. Match `name`
  case-insensitively, as cs_tools `untag` does (`casefold`).
- **Create tag**: `{name, color}`. cs_tools uses `color: "#A020F0"`. An "already exists"
  error is not a failure; reuse the tag.
- **Assign tag**: `{metadata: [{identifier: "{guid}", type: "{ANSWER|LIVEBOARD}"}, ...],
tag_identifiers: ["{tag_name}"]}`. One call can carry many objects. This skill sends
  batches of up to 100; cs_tools sends one object per call. If a batch errors, retry
  that batch one object per call and report each object that still fails.
- **Unassign tag**: the same shape as assign, with the same batching and retry. It
  removes the association only; the tag stays defined.
- **Deleting the tag** (Untag choice b, Remove Step 8): cs_tools does **not** use the
  delete tag operation. It calls **delete metadata** with the tag's GUID,
  `{"metadata": [{"identifier": "{tag_id}"}]}`, which removes the tag from every object
  type. This skill does the same. Fallback only if that is rejected: the **delete tag**
  operation, with the tag's id in the **path** and no body. Success is 204 for both.

---

## Export metadata TML (Remove Step 7)

```json
{
	"metadata": [{ "identifier": "{guid}" }],
	"edoc_format": "YAML",
	"export_fqn": true
}
```

Send one object per call, up to 4 at a time, as cs_tools does. The response is an array.
Each element has `edoc` (the TML text), `info.type` (for example `liveboard` or
`answer`), and `info.status.status_code`. Treat `ERROR` as a failure even on HTTP 200.

---

## Delete metadata (Remove Step 8, and the tag in Untag choice b)

POST with a JSON body:

```json
{ "metadata": [{ "identifier": "{guid}" }] }
```

Send one object per call, up to 15 at a time, so one failure doesn't block the rest.
Success is 204.
