---
description: Move per-tenant Model copies created by TML export/import onto ThoughtSpot Orgs Publishing, so one governed Model serves every Org instead of a copy per Org
---

# Migrate TML Model copies to Orgs Publishing

Customers who adopted Orgs before Publishing existed usually have **one Model per tenant**,
each made by exporting TML from the Primary Org and importing it into a tenant's Org. Every
schema change then has to be repeated per Org, and the copies drift.

This skill converts that estate to the publishing pattern: **one** governed Model in the
Primary Org, published into each tenant Org, with each tenant's Answers and Liveboards
repointed onto it. The tenant's copy is **kept**, not deleted — it is the rollback.

## When to Use

Apply this skill when a customer has per-Org Model copies and wants to adopt Orgs
Publishing without rebuilding their content, and when the inputs available are TML exports
rather than access to both Orgs.

Not this skill: distributing a Model outward to Orgs that hold no copies yet (ordinary
publishing), or moving a tenant into a brand-new Org.

## The question you are actually answering

**Can the governed Model stand in for the tenant's copy?** That is structural, not a naming
question. Two Models with different names, different column labels and different warehouse
schemas can be perfect substitutes; two with identical names can be incompatible.

What decides it is whether every column the tenant's content reads still resolves to the
same warehouse column, and whether the shape carrying those columns agrees. Both are
decidable offline from two TML exports — see
[references/assessing-two-exports.md](references/assessing-two-exports.md).

## Prerequisites

- **Orgs enabled**, and Orgs Publishing enabled for your instance. Confirm with ThoughtSpot
  — availability varies by release
- **Administrator privilege in the Primary Org.** Objects can only be published from the
  Primary Org, and modifying a published object requires administrator privilege *there* —
  an Org administrator of a tenant Org cannot do it, even for their own Org's content
- **Membership in every Org involved.** The dependent lookup and the repoint run inside the
  tenant Org and take their scope from your session. A missing membership shows up as an
  **empty dependent list**, not as a permission error — which reads exactly like "nothing
  to migrate"
- Two TML exports per Model: one from the Primary Org, one from the tenant Org

## Procedure

Steps 1–5 write nothing. Confirm with the customer before each step from 6 onward.

| # | Step | Writes? |
|---|---|---|
| 1 | Collect both TML exports per Model | no |
| 2 | Pair the tables and compare structure | no |
| 3 | Review findings and the column map | no |
| 4 | Identify the fields that differ per Org | no |
| 5 | Report the verdict: READY / RENAME / BLOCKED | no |
| 6 | Parameterize the per-Org fields on the governed Model | yes |
| 7 | Re-key the copy's custom object id | yes |
| 8 | Publish the governed Model into the tenant Org | yes |
| 9 | Find what depends on the copy | no |
| 10 | Repoint each dependent | yes |
| 11 | Verify | no |

**Export both with dependencies**, rooted at the Model, not at a Liveboard:
`export_associated: true`, `export_fqn: true`, `edoc_format: YAML`.

Two silent mistakes to catch at Step 1: both exports taken from the same Org (they compare
perfectly clean, because they are the same object — compare the root GUIDs), and platform
entries in the zip that will not parse. Never filter zip entries by name to work around the
second; name the entry that failed.

## Order matters: 6 and 7 before 8

**Parameterization is the work, not a preliminary.** A Model whose dependency tree contains
no template variable cannot be published at all — the platform refuses with *"No template
variable node found in the dependency tree."* The per-Org fields found at Step 4 (typically
the warehouse `schema`, sometimes the database or table name) become variables with a value
per Org.

One trap: that check is an **existence** check across the whole tree, not a completeness
check. If *something* in the tree is parameterized the publish succeeds — even if a table
you meant to parameterize was missed. A partially parameterized publish exposes Primary Org
data to the tenant. Verify every field you intended, per Org, yourself.

**The copy inherited the original's custom object id.** That id must be unique within an
Org, and publishing makes the governed Model a member of the tenant's Org — so both objects
are then in one Org carrying one id, and the publish is refused. Re-key **the copy**, not
the governed Model, via `POST /api/rest/2.0/metadata/headers/update` from a tenant-Org
session. Always set a new value; never blank it.

## Let the platform refuse what only it can see

Publishing validates before writing anything, and the commit is transactional — a refused
publish leaves the estate completely unchanged. So an attempted publish is cheap. It
refuses on:

| Error | Meaning |
|---|---|
| `Cannot publish/unpublish objects with Cohort Column as dependency` | a Set is in the closure. Sets are invisible in TML, so do not try to detect one from the exports — attempt the publish and read this |
| `No template variable node found in the dependency tree` | Step 6 was skipped or did not land |
| duplicate custom object id | Step 7 was skipped for this Org |
| `Objects can only be published/unpublished from primary org` | wrong Org session |

Spend the offline effort on what TML *can* settle — correspondence and shape. Let the
platform refuse the rest.

## Repointing, and its two traps

A dependent references the **columns** it reads, so what moves it is swapping the Model
reference it resolves through: export its TML, swap `tables[].fqn` from the copy's GUID to
the governed Model's GUID, apply the column map, re-import over the same object.

**Views are a layer, not an endpoint.** A dependent that is a View or SQL View exposes its
own column names to everything built on it. Rewrite the names it *reads* — `tables[].fqn`,
formulas, column references — and **preserve exactly** the names it *exposes* and its own
name. Get this wrong and every Answer above the View breaks, and none of them appear in the
copy's dependent list, because they depend on the View. Get it right and content on that
View needs no rewrite at all. Do Views first, then re-run the dependent lookup.

**Some dependents are nested.** A dependency can be carried by a hidden object belonging to
a Liveboard rather than by the Liveboard itself. Repoint the **owner**, and de-duplicate —
several nested objects in one Liveboard collapse to one rewrite.

Check coverage **before** importing: scan the rewritten document for any surviving reference
to a source column name. A partial rewrite imports cleanly and renders wrong, which the
customer finds rather than you. After importing, confirm the object resolves to the governed
Model.

## What a TML round trip does not carry

Presentation, not meaning. Conditional formatting, column widths, chart state, parameter
ids and Liveboard tile layout are not guaranteed to survive a re-import. Which columns an
Answer reads, what it computes and what it filters are.

So **do not refuse a migration to protect formatting** — that leaves the Answer pointing at
a Model about to be retired, which is worse. Instead: disclose per dependent before writing,
keep the pre-repoint export as both rollback and reference, and verify that the Answer
returns the **same numbers**, never that the documents match.

## Safety

Nothing is deleted. At every stage there is a way back:

| Stopped after | To undo |
|---|---|
| 1–5 | nothing was written |
| 6 | un-parameterize the fields |
| 7 | set the previous custom object id back |
| 8 | unpublish from that Org |
| 10, partly | re-import the pre-repoint TML for the ones already moved |

**Validate the whole sequence in a non-production Org before running it against a tenant's
live content**, and repoint one dependent at a time rather than in a batch — a failure
part-way leaves the rest still pointing at the copy, which is a safe state.

## Not covered

- **Deleting the copy.** Deliberately: it is the rollback. Retiring it is a separate
  decision, after verification
- **Answers and Liveboards as publish roots.** They are read as dependents to be repointed
- **Sets / Cohorts.** They block publishing and cannot be seen in TML. Resolve with the
  customer
- **Sharing and permissions.** TML carries no sharing information, so nothing here
  preserves or migrates it. Check the published Model's grants in each tenant Org explicitly
- **Tenant data isolation.** Publishing one Model to several Orgs does not by itself
  separate their data — that comes from row-level security or from the publication
  variables. It is a required review, and it is not established by this migration
