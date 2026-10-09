# Open Items — Unverified Behaviour

The request shapes in [api-shapes.md](api-shapes.md) come from the calls cs_tools makes
against REST v2.0. These items are where this skill does something cs_tools doesn't, or
where the response shape was never confirmed live.

## 1. TS: BI Server from a non-Primary Org — UNVERIFIED

cs_tools queries TS: BI Server before switching Org, so always from the Primary Org, and
filters by `[Org Name]`. This skill has no Org switch. Confirm whether TS: BI Server is
visible and populated from a token scoped to a non-Primary Org, and whether the
`[Org Name]` filter is needed there. Until this is verified, a non-Primary Org where
TS: BI Server can't be read is unsupported. The skill must not fall back to a Primary Org
token, because its tag and delete calls would then act on the Primary Org.

[Record result here]

## 2. Search groups: sub-groups field — UNVERIFIED

cs_tools resolves group members through the v1 group users endpoint, matching both
`assignedGroups` and `inheritedGroups`. This skill uses REST v2.0 search groups with
`include_users: true`, and expands sub-groups recursively. Confirm the sub-group field
name (`sub_groups`) and that `users` lists direct members only.

[Record result here]

## 3. Tag assign and unassign batch size — UNVERIFIED

cs_tools assigns one object per call (15 at a time). This skill batches up to 100 objects
per call, because the operation accepts an array. Confirm the upper limit, and whether a
batch fails as a whole when one object can't be tagged. Until confirmed, a failed batch
is retried one object per call (see [modes.md](modes.md#batch-failures)).

[Record result here]

## 4. Delete metadata on a TAG GUID — UNVERIFIED

cs_tools deletes the tag by sending its GUID to delete metadata, without a type. Confirm
this works on current REST v2.0 releases. Until confirmed, the skill falls back to the
delete tag operation when delete metadata rejects it.

[Record result here]
