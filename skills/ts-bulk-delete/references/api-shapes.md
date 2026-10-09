# API Shapes

Field names and payload shapes this skill relies on. They come from the REST v2 OpenAPI
spec and from the cs_tools `bulk-deleter` implementation this skill was ported from.
Always resolve the exact operation and path with `get-rest-api-reference` before calling.
This file documents shapes, never paths. Anything not yet confirmed live is tracked in
[open-items.md](open-items.md).

---

## Get current user info (Step 1)

Top-level fields used: `privileges` (array of strings, check for the exact string
`ADMINISTRATION`), `current_org` `{id, name}`, and `orgs` `[{id, name}, ...]`.

---

## Search metadata — downstream (Step 4, Downstream)

```json
{
	"metadata": [{ "identifier": "{root_guid}" }],
	"include_headers": true,
	"include_details": true,
	"include_dependent_objects": true,
	"dependent_objects_record_size": -1
}
```

`-1` means unlimited. The response is an array with one element for the root:

- `metadata_id`, `metadata_name`, `metadata_type`
- `metadata_header`: `{author, authorName, modified (epoch ms), tags, type}`. The
  header's `type` is the subtype, for example `WORKSHEET`, `MODEL`, or
  `ONE_TO_ONE_LOGICAL`.
- `dependent_objects`: `{ <guid>: { <V1_TYPE>: [ {id, name, author, authorName,
modified, tags, type}, ... ] } }`

Dependent type keys come back as v1 names. Map `PINBOARD_ANSWER_BOOK` → `LIVEBOARD` and
`QUESTION_ANSWER_BOOK` → `ANSWER`. Other keys (`LOGICAL_TABLE`, `CONNECTION`) pass
through unchanged. `authorName` can be missing on a dependent, so show `UNKNOWN`.

**Connection roots**: dependents are not returned for a Connection (open item 1). Use
`metadata_detail.logicalTableList[].header.id` to get the Connection's tables. Run the
same search for each table without `include_details`, add each table as a target, and
flatten each table's `dependent_objects`. Track each table whose search fails, so Step 4
can name it and mark the run partial.

---

## Search metadata — by tag / list (Step 4, By tag and GUID list)

By tag, one entry per type:

```json
{
	"metadata": [{ "type": "LIVEBOARD" }],
	"tag_identifiers": ["{tag_id}"],
	"include_headers": true,
	"record_offset": 0,
	"record_size": 500
}
```

Types: `CONNECTION`, `LOGICAL_TABLE`, `LIVEBOARD`, `ANSWER`. Paginate with
`record_offset` until a page is shorter than `record_size`. Track each type and offset
that fails, so Step 4 can name it. cs_tools (`fetch_all`) logged and skipped them.

GUID list, at most 25 identifiers per call (cs_tools `_MAX_IDENTIFIERS_PER_SEARCH`):

```json
{
	"metadata": [{ "identifier": "{guid_1}" }, { "identifier": "{guid_25}" }],
	"include_headers": true,
	"record_offset": 0,
	"record_size": 25
}
```

`record_size` must be at least the batch size. If it's left out, the default page
(about 10) truncates the response. The response carries the same `metadata_id`/
`metadata_name`/`metadata_type`/`metadata_header` fields as above. A GUID is not found
only when a complete 2xx response for its batch has no element for it. For each missing
GUID, retry once with `{ "type": "CONNECTION", "identifier": "{guid}" }` before marking
it not found (open item 4).

Target fields come from each element: `guid` ← `metadata_id`, `name` ← `metadata_name`,
`type` ← `metadata_type`, `subtype` ← `metadata_header.type`, `author_guid` ←
`metadata_header.author`, `author` ← `metadata_header.authorName`, `modified` ←
`metadata_header.modified`. For dependents, `guid` ← `id`, `name` ← `name`,
`author_guid` ← `author`, `author` ← `authorName`, `modified` ← `modified`. A
dependent's `type` comes from its `dependent_objects` dict key, mapped from the v1 name
as above (`LIVEBOARD`, `ANSWER`, `LOGICAL_TABLE`, `CONNECTION`). The dependent's own
`type` field is its **subtype** (for example `WORKSHEET`). If `subtype` is missing, Step
9 uses the Table tier.

---

## Search tags (Step 4, By tag and Tag only)

`{ "tag_identifier": "{tag_name}" }`. The response is an array of `{id, name, ...}`, and
an empty array means not found. Match on `name` exactly, because tag names are
case-sensitive.

**Fallback** (search tags can't be resolved, or returns nothing): search metadata, as
cs_tools does with `fetch_one(tag_name, "TAG")`:

```json
{ "metadata": [{ "type": "TAG", "identifier": "{tag_name}" }] }
```

Take the element whose `metadata_name` equals `{tag_name}` exactly, and use its
`metadata_id` as `{tag_id}`. cs_tools takes the first element without comparing names,
but its option is documented as case-sensitive, so the exact match keeps that behaviour.

---

## Export metadata TML (Step 8)

```json
{
	"metadata": [{ "identifier": "{guid}" }],
	"export_fqn": true,
	"edoc_format": "YAML"
}
```

The response is an array. Each element has `edoc` (the TML text), `info.type` (the TML
type, used for the file layout), and `info.status.status_code`. Treat any of these as an
export failure: a non-2xx response, an empty array, or `"ERROR"` in the first element
(even on HTTP 200). cs_tools (`metadata.py`, `tml_export`) returns ERROR for all three.

---

## Delete metadata (Step 9)

```json
{ "metadata": [{ "identifier": "{guid}" }] }
```

Send the identifier only, as cs_tools does. ThoughtSpot resolves the type from the GUID,
and a wrong `type` could make a valid delete fail. Send one object per call. The array accepts several objects, but whether a batch is
all-or-nothing is unverified (open item 2), and per-object calls keep failures isolated.
Success is 204 with an empty body.

---

## Delete tag (Step 9, Tag only)

The tag identifier (id or name) goes in the **path**. There is no body. Success is 204.
Anything else is a failure. Report it; cs_tools never checked this response.
Deleting a tag doesn't delete the objects it was assigned to.

---

## CSV report (Step 10)

Columns, in order. The first seven are cs_tools' `deleter_report` table (`models.py`).
`status` is added by this skill.

| Column        | Value                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| `type`        | Target type, for example `LIVEBOARD`, `LOGICAL_TABLE`, or `TAG`                 |
| `guid`        | Target GUID                                                                     |
| `modified`    | Last modified, ISO 8601 UTC                                                     |
| `reported_at` | When the report was written, ISO 8601 UTC, same for every row                   |
| `author_guid` | Author GUID                                                                     |
| `author`      | Author display name, or `UNKNOWN`                                               |
| `name`        | Object name                                                                     |
| `status`      | `DELETED`, `DELETE_FAILED`, `EXPORTED`, `EXPORT_FAILED`, `PREVIEW`, `NOT_FOUND` |

Quote any value that contains a comma, quote or newline. A `NOT_FOUND` row has only
`guid` and `status`. A `DELETE_FAILED` row can add the last error after the status, for
example `DELETE_FAILED: 403`.
