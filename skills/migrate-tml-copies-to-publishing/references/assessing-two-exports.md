# Assessing two TML exports

Everything on this page is decidable **offline**, from the two export zips, with no
connection to either Org. It is the whole of Steps 1–5, and it is where the judgement in
this migration actually lives.

## What TML carries, and why that is enough

A Model export carries more than labels:

| in the TML | what it settles |
|---|---|
| `db_name`, `schema`, `db_table`, `db_column_name` | the **physical binding** — which warehouse column a Model column reads |
| `model_tables` / `fqn` | which tables the Model is built from |
| each join's `on`, `type`, `cardinality` | the **shape** carrying those columns |
| `formula` | derived columns, comparable as text |
| column `name`, `description` | the tenant-facing labels, which may differ freely |

So correspondence ("is this the same warehouse column?") and shape ("does the schema graph
agree?") are both computable without touching a cluster. Names are the one thing that may
differ, and the mapping between them is the output.

## Pair the tables before comparing anything

Do not pair by name — a copy may have been renamed. Pair on **column sets**: for each table
in the governed export, find the table in the tenant export whose `db_column_name` set
overlaps most. A clean pair overlaps at or near 1.00.

Report the overlap for every pair. An overlap well below 1.00 that still wins is the
signal that the two Models have diverged, and it deserves a human look rather than a
verdict.

## Compare, and what may legitimately differ

Three differences are expected and are **not** findings:

- **`schema`** (and sometimes `db_name` or `db_table`) — this is exactly what per-Org
  parameterization exists to carry. Collect these; they become Step 6's work
- **connection name** — compare the connection *type* instead
- **GUIDs** — every object has its own

Everything else is a finding. In particular:

- a column the tenant's content uses that the governed Model does not have — **blocking**,
  and no mapping can fix it. Ask the customer; do not guess a near match
- a differing `formula` for columns that otherwise correspond — blocking
- a join present on one side and not the other, or with a different `on` clause

`cardinality` is **view-relative**: the same join reads `ONE_TO_MANY` or `MANY_TO_ONE`
depending on which table's block it is written under. Normalise before comparing, or every
join looks changed.

## The column map is the output

Where corresponding columns carry different names, record
`tenant name -> governed name`. That map drives the repoint later, and it is the artifact
worth reviewing with the customer before any write:

- an **identity** map means no content rewriting is needed for names at all — the cheapest
  possible migration
- a non-empty map means every dependent must be rewritten, and each rewrite is a chance to
  get a name wrong

Review the map before Step 6, not after Step 8.

## Verdicts

| verdict | meaning |
|---|---|
| `READY` | corresponds cleanly, identity column map — publish and repoint |
| `RENAME` | corresponds cleanly, but names differ — same path, plus content rewriting |
| `BLOCKED` | something no mapping can fix. Report it and stop |

Running this across a whole estate first is worth far more than doing it one Model at a
time: a sweep that reports twelve Models `READY` and three `BLOCKED` is one conversation
with the customer instead of fifteen.

## Two holes to be honest about

**Multi-join-path.** Where the same table occupies several slots in the schema graph
(role-playing dimensions — an order date and a ship date on the same calendar table), the
column sets are identical and pairing cannot tell the slots apart. Detect the condition —
the same table appearing more than once in the join graph — and escalate rather than
reporting a clean pair.

**Where a pair binds the same warehouse column under different labels**, the comparison
sees a match on binding and a difference on name, which is exactly the `RENAME` case. That
is correct. But two *different* columns that happen to bind the same warehouse column are
indistinguishable from each other on binding alone. Fall back to name and formula, and
surface both candidates rather than choosing.

## Two things TML cannot see at all

- **Sets / Cohorts.** They do not appear in a TML export, and they block publishing.
  A clean assessment is not evidence that there is no Set. The publish attempt is the only
  test, and it refuses without writing anything
- **Sharing and permissions.** No sharing information is carried, so a clean assessment
  says nothing about who can see what afterwards

A clean assessment means *the governed Model can stand in for the copy*. It does not mean
the migration will succeed.
