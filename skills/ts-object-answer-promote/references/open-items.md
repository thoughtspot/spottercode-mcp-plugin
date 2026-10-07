# Open Items — Unverified Behaviour

Items 2–5 are carried over from the CLI version of this skill (thoughtspot-agent-skills),
keeping its numbering, and were tested against champ-staging there. Items 6–7 are new
with the move to REST + JSON TML.

## 2. Edit permission in the metadata search response — UNVERIFIED

Metadata search returns no explicit permission field. A security metadata fetch
returned HTTP 500 on champ-staging. Current approach: no permission pre-flight check.
Warn when `metadata_header.author` isn't the current user, and rely on the import
response for access errors.

Still to test: importing into a Model shared READ_ONLY, and the security metadata fetch
on newer instance versions.

[Record result here]

## 3. Bare display-name column references in Model formulas — UNVERIFIED

Translating `[display_name]` to `[TABLE::COLUMN_ID]` works (verified on champ-staging),
and the script always translates. Whether untranslated bare names would also import is
untested. It only matters if the translation is ever dropped.

[Record result here]

## 4. Answers embedded in Liveboards — DEFERRED

Only standalone saved Answers are supported. Search for type `ANSWER` doesn't return
Liveboard-embedded Answers, so there is no shipped path that could produce a wrong
result. Promoting from an embedded Answer is future work (BL-039 in the source repo).

## 5. Sets (cohorts) — DEFERRED

Sets are `answer.cohorts[]`, not `formulas[]`. The structure was verified on
champ-staging. Sets are detected and listed as out of scope, and are never promoted.
Building a standalone set object is future work (BL-039).

## 6. JSON TML export and import — UNVERIFIED

This skill exports with `edoc_format: "JSON"` and imports `JSON.stringify(mergedTml)`,
so no YAML library is needed. The CLI version used YAML both ways. Confirm on a live
instance that:

- JSON export of Answer and Model TML carries the same keys as the YAML export
  (including `guid` at the root, and `formulas[].was_auto_generated`)
- import accepts a JSON TML string, with `create_new: false` updating in place

If JSON import is rejected, serialize `mergedTml` to YAML (double-quote any `expr`
containing `[ ] { } :`) and import that instead.

[Record result here]

## 7. Model lookup by LOGICAL_TABLE search — UNVERIFIED

Step 5's fallback searches type `LOGICAL_TABLE`, which also returns Tables and Views.
The Model check happens after export (a top-level `model` key). Confirm whether a
subtype filter can narrow the search to Models only.

[Record result here]
