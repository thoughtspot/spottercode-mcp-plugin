# API Shapes

Field names and payload shapes this skill relies on, taken from the REST v2 OpenAPI spec
and the original CLI implementation. Always resolve the exact operation and path with
`get-rest-api-reference` before calling. This file documents shapes, never paths. Items
not yet confirmed against a live response are tracked in [open-items.md](open-items.md).

---

## Search variables (Search Flow, Step 6 Remove lookup)

```json
{
	"record_offset": 0,
	"record_size": 50,
	"response_content": "METADATA_AND_VALUES",
	"variable_details": [{ "identifier": "ts_user_timezone" }]
}
```

The response is an array. `data[0]` is the `ts_user_timezone` record, and its `values`
array holds the assignments. Each assignment carries `org_identifier`, `principal_type`
(`"USER"` or absent/null for org level), `principal_identifier`, and the value itself
(`value` or `assigned_values`, see open item 1). Pagination is not needed because the
identifier is given.

---

## Search orgs (Step 3)

```json
{ "record_offset": 0, "record_size": 50, "status": "ACTIVE" }
```

Paginate with `record_offset` until a page is shorter than `record_size`. The name field
casing is unverified (open item 2).

---

## Search users (Step 4, option 2)

```json
{
	"record_offset": 0,
	"record_size": 50,
	"name_pattern": "{user_search_term}",
	"org_identifiers": ["{org}", "..."],
	"account_status": "ACTIVE"
}
```

Paginate with `record_offset` until a page is shorter than `record_size`. Each element
has `id` and `name`, plus display-name and email fields whose casing is unverified
(`display_name`/`email` vs. `displayName`/`mail`, open item 4). `name` is the login name,
and is what goes into `principal_identifier`.

---

## Search groups (Step 4, option 3)

```json
{
	"record_offset": 0,
	"record_size": 50,
	"name_pattern": "{group_search_term}",
	"org_identifiers": ["{org}", "..."],
	"include_users": true
}
```

Paginate the same way as search users. Each element is `{id, name, display name,
users: [...]}`. `users` is present only because
`include_users` is true. There is no count field, so use `users.length` (open item 3).

---

## Update variable values (Step 6)

The variable identifier (`ts_user_timezone`, URL-quoted) goes in the **path**. The body
is:

```json
{
	"operation": "REPLACE",
	"variable_assignment": [
		/* entries */
	]
}
```

`operation` is `REPLACE` for Set or `REMOVE` for Remove.

**Org-level entry**: one per org, with no principal keys at all.

```json
{ "assigned_values": ["{value}"], "org_identifier": "{org}" }
```

**User-level entry**: one per org × user pair.

```json
{
	"assigned_values": ["{value}"],
	"org_identifier": "{org}",
	"principal_type": "USER",
	"principal_identifier": "{user}"
}
```

For REPLACE, every entry carries `{timezone_value}`. For REMOVE, each entry carries the
value currently assigned to that exact scope, as found in the search-variables lookup.

Success is HTTP 204 with an empty body. Failure returns JSON with an `error` key.
