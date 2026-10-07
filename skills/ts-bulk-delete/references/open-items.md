# Open Items — Unverified Behaviour

Carried over from, or introduced by, porting the cs_tools `bulk-deleter` CLI tool. None of
these has been checked against a live instance through this skill yet.

## 1. Dependent objects for Connections — UNVERIFIED

cs_tools notes (2024-11-30) that searching metadata with `include_dependent_objects` does
not return dependents when the root is a `CONNECTION`. Its workaround is to search each of
the Connection's logical tables instead. Check whether current releases return Connection
dependents directly. If they do, the per-table path in Step 4 can be dropped.

[Record result here]

## 2. Delete metadata: batch semantics — UNVERIFIED

Delete metadata accepts an array of objects, but cs_tools always sent one per call. It is
unknown whether a multi-object call fails as a whole when one object can't be deleted, or
deletes the rest. Until confirmed, Step 9 sends one object per call.

[Record result here]

## 3. Search tags request field — UNVERIFIED

The field name for looking up a tag by name (`tag_identifier`) is taken from the spec.
cs_tools resolved tags through a general metadata fetch instead. Confirm the request shape
and the response's name/id fields.

[Record result here]
