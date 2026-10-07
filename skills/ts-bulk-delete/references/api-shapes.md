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
flatten each table's `dependent_objects`.

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
`record_offset` until a page is shorter than `record_size`.

GUID list: `"metadata": [{ "identifier": "{guid}" }, ...]`, with `include_headers: true`.
The response carries the same `metadata_id`/`metadata_name`/`metadata_type`/
`metadata_header` fields as above. A GUID with no element in the response is not found.

---

## Search tags (Step 4, By tag and Tag only)

`{ "tag_identifier": "{tag_name}" }`. The response is an array of `{id, name, ...}`, and
an empty array means not found. Match on `name` exactly, because tag names are
case-sensitive.

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
type, used for the file layout), and `info.status.status_code`. Treat `"ERROR"` as an
export failure even on HTTP 200.

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
