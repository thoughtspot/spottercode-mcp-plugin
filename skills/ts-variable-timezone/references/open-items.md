# Open Items — Unverified Behaviour

Carried over from the CLI-based `ts-variable-timezone` skill in thoughtspot-agent-skills.
None of these has been checked against a live instance yet.

## 1. Search-variables response: value field naming — UNVERIFIED

The source CLI documents each entry in a variable's `values[]` as having a `value` field
(singular). The write-path payload uses `assigned_values` (a plural array). These are
different sides of the API, so they aren't necessarily inconsistent. The read shape was
never confirmed, though. Before extracting a current value (Search Flow, Step 5 lookup),
inspect one real element, and use whichever key is present.

[Record result here]

## 2. Search-orgs response: field casing — UNVERIFIED

Element field names (`id`/`name` vs. `orgId`/`orgName`) were inconsistent across sources
in the original CLI implementation. Inspect one element at runtime rather than hardcoding
a casing.

[Record result here]

## 3. Search-groups: user count field — UNVERIFIED

With `include_users: true`, each group returns a nested `users[]` array. The source
implementation had no dedicated count field (such as `userCount`). Derive the count as
`users.length`.

[Record result here]

## 4. Search-users response: display-name and email field casing — UNVERIFIED

The source CLI's docstring lists `displayName` and `mail`. REST v2 responses are mostly
snake_case (`display_name`, `email`). Inspect one element at runtime and use whichever
keys are present.

[Record result here]
