# API Shapes

Field names and payload shapes this skill relies on. They come from the REST v2 OpenAPI
spec and from ts-cli, which the CLI version of this skill called. Always resolve the
exact operation and path with `get-rest-api-reference` before calling. This file
documents shapes, never paths. Anything not yet confirmed live is tracked in
[open-items.md](open-items.md).

---

## Get current user info (Step 1)

Top-level fields used: `id` (compared with the Model's `author` in Step 5), and
`current_org` `{id, name}`.

---

## Search metadata (Steps 2 and 5)

Answer by name:

```json
{
	"metadata": [{ "type": "ANSWER", "name_pattern": "%{search_term}%" }],
	"include_headers": true,
	"record_offset": 0,
	"record_size": 50
}
```

**Paginate.** The response is a plain array. Repeat the call with `record_offset`
increased by `record_size` until a page returns fewer than `record_size` elements, and
concatenate the pages. Show at most the first 50 matches; if there are more, say how
many and ask the user to narrow the term (or pick from the 50 shown).

Model by name: the same, with `"type": "LOGICAL_TABLE"` plus the subtypes filter set to
`WORKSHEET` (ts-cli sent `"subtypes": ["WORKSHEET"]` on the metadata entry; confirm the
field with `get-rest-api-reference`). Without it, Tables and Views match too (open item
7). Model by GUID (auto-detect): `"metadata": [{ "identifier": "{data_source_guid}" }]`.

Each element carries `metadata_id`, `metadata_name`, `metadata_type`, and
`metadata_header`. Header fields used:

| Field                                  | Use                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `author`                               | Owner's user id, compared with the current user (Step 5)                                                                                   |
| `authorDisplayName`                    | Owner's display name for the ownership warning (`authorName` if absent)                                                                    |
| `contentUpgradeId`, `worksheetVersion` | `[MODEL]` if `contentUpgradeId` is `WORKSHEET_TO_MODEL_UPGRADE` or `MODEL_UPGRADE`, or `worksheetVersion` is `V2`; otherwise `[WORKSHEET]` |

The header has no permission field (open item 2). The search response does not include
an Answer's data source. Take that from the Answer TML (`answer.tables[0].fqn`).

---

## Export metadata TML (Steps 3 and 6)

```json
{
	"metadata": [{ "identifier": "{guid}" }],
	"export_fqn": true,
	"edoc_format": "JSON"
}
```

The response is an array. Each element has `edoc` (the TML as a JSON string, so parse it
with `JSON.parse`) and `info.status.status_code`. Treat `ERROR` as a failure even on HTTP 200. The parsed document's top-level key is the object type: `answer`, `model`, or
`worksheet`. `guid` sits beside it at the root. `export_fqn` makes table references carry
GUIDs, which avoids "multiple data sources with same name" errors on import.

---

## Import metadata TML (Step 9)

```json
{
	"metadata_tmls": ["{JSON.stringify(mergedTml)}"],
	"import_policy": "ALL_OR_NONE",
	"create_new": false
}
```

`metadata_tmls` takes TML strings, either YAML or JSON (JSON import is open item 6). If
JSON is rejected, send `mergedTml` serialized as YAML instead (SKILL.md Step 9).
`create_new: false`, plus `guid` at the document root, makes this an in-place update. A
`guid` nested under `model:` is ignored, and the import creates a duplicate Model.

The response is an array with one element per TML. Check
`response.status.status_code` (`OK` or `ERROR`) and `response.status.error_message`. On
success, `response.header.id_guid` is the Model GUID, and should equal `{model_guid}`.
