# API Shapes

Field names and payload shapes this skill relies on. They come from the REST v2 OpenAPI
spec and from the sibling skills' verified shapes. Always resolve the exact operation and
path with `get-rest-api-reference` before calling. This file documents shapes, never
paths. Anything not yet confirmed live is tracked in [open-items.md](open-items.md).

Only the Live source (Step 1, choice B) makes these calls. Local files make none.

---

## Get current user info (Step 2a)

Fields used: `current_org` `{id, name}`, to say which Org the Models are listed from.

---

## Search metadata (Step 2b)

Models by name (omit `name_pattern` to list every Model):

```json
{
	"metadata": [
		{
			"type": "LOGICAL_TABLE",
			"subtypes": ["WORKSHEET"],
			"name_pattern": "%{term}%"
		}
	],
	"include_headers": true,
	"record_offset": 0,
	"record_size": 50
}
```

Confirm the subtypes field name with `get-rest-api-reference` (open item 1). The
CLI original sent `--subtype ONE_TO_ONE_LOGICAL`, which is the subtype of physical
Tables, not Models.

Models by GUID: `"metadata": [{ "identifier": "{guid}" }, ...]` with `include_headers:
true` and `record_size` at least the number of GUIDs.

**Paginate.** The response is a plain array. Repeat with `record_offset` increased by
`record_size` until a page has fewer than `record_size` elements, and concatenate.

Each element carries `metadata_id`, `metadata_name`, `metadata_type` and
`metadata_header`. Header fields used:

| Field                                  | Use                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `contentUpgradeId`, `worksheetVersion` | `[MODEL]` if `contentUpgradeId` is `WORKSHEET_TO_MODEL_UPGRADE` or `MODEL_UPGRADE`, or `worksheetVersion` is `V2`; otherwise `[WORKSHEET]` |
| `authorDisplayName` (or `authorName`)  | Author column in the pick list                                                                                                             |
| `modified`                             | Last-modified column in the pick list (epoch ms)                                                                                           |

The export in Step 3 is authoritative: an object is drawn only if its TML has a top-level
`model` key.

---

## Export metadata TML (Step 3)

One Model per call:

```json
{
	"metadata": [{ "identifier": "{model_guid}" }],
	"export_associated": true,
	"export_fqn": true,
	"edoc_format": "JSON"
}
```

- `export_associated` adds the Table TMLs (and SQL views) the Model uses. Without them
  the ERD has no cardinality, join type, join origin, RLS or join keys.
- `export_fqn` writes each `model_tables[].fqn` as the Table's GUID. The builder matches
  Table TMLs to the Model by that GUID first, then by name.
- `edoc_format: "JSON"` makes each `edoc` a JSON string, which the builder parses
  without a YAML library (open item 2).

The response is an array, one element per object:

```json
[
	{
		"info": { "name": "Sales", "type": "model", "status": { "status_code": "OK" } },
		"edoc": "{\"guid\":\"...\",\"model\":{\"name\":\"Sales\",\"model_tables\":[...]}}"
	},
	{
		"info": { "name": "ORDERS", "type": "table", "status": { "status_code": "OK" } },
		"edoc": "{\"guid\":\"...\",\"table\":{\"name\":\"ORDERS\",\"joins_with\":[...]}}"
	}
]
```

Treat `info.status.status_code` `ERROR` as a failure even on HTTP 200. Save the whole
array, unchanged, as `{model_guid}.export.json`.

---

## What the builder accepts

`scripts/build_erd.ts` takes any mix of:

| Input                                    | Example                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| The export response array, as saved      | `[{"info": {...}, "edoc": "<JSON TML string>"}, ...]` |
| One element of it                        | `{"edoc": "<JSON TML string>"}`                       |
| Already-parsed elements                  | `[{"edoc": {"guid": "...", "model": {...}}}, ...]`    |
| A bare TML object, or an array of them   | `{"guid": "...", "table": {...}}`                     |
| A folder of any of the above (recursive) | `.json`, `.tml`, `.yaml`, `.yml` files holding JSON   |

Anything that isn't a `model` or `table` TML (`info` blocks, SQL views, Liveboards,
other JSON files in the folder) is ignored.
