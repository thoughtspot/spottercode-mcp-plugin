# Test scenarios: migrate TML Model copies to Orgs Publishing

Companion to [migrate-tml-copies-design.md](migrate-tml-copies-design.md). Ordered from
basic to complicated: each level assumes the one before it passes. `Q` numbers refer to the
design's open questions; a scenario lists the ones it answers.

Status: **In progress** — basic scenario (1.2 + 1.4) **passed** 2026-09-28; see Results.

## Fixtures

Built once and reused. Every scenario starts from a fresh copy of these unless it says
otherwise.

| Fixture | Contents |
|---|---|
| **Warehouse** | Database `TS_MIGRATION_DEMO`, three schemas with the same two tables, `SALES_FACT` (fact) and `PRODUCT_DIM` (dimension): `PRIMARY_DATA` (read by the Primary Org), `ORG1_DATA` (read by org1), `SHARED_DATA` (read by both — Level 3 shared-data scenarios). The schemas must hold **different rows**, so reading the wrong schema shows as wrong numbers |
| **Primary Org** | Connection; Tables on `PRIMARY_DATA`; governed Model **`PRIMARYmodel`** (GUID `faea95b6-6006-4a63-ae38-5937339d1c1f`, `obj_id` `PRIMARYmodel-faea95b6`, on `nebula-test-27sep`), `SALES_FACT` → `PRODUCT_DIM`, 12 columns (below), with an `obj_id`. **Add one formula**, `Margin = [Revenue] - [Cost]`, for the formula scenarios |
| **Secondary Org `org1`** | Connection; the copy of `PRIMARYmodel`, made by exporting from Primary and importing with the schema changed to `ORG1_DATA` |
| **Principals in org1** | Group `org1_analysts` with non-admin member `org1_user`; a second non-admin user `org1_viewer`, **not** in the group; the migrating admin |
| **Exports** | Governed and copy TML exported from the UI **with dependencies**, and again via REST with `export_fqn: true` |

**`PRIMARYmodel` columns**

| Column | Source | Type |
|---|---|---|
| Sale Id | `SALES_FACT.SALE_ID` | MEASURE (SUM) |
| Product Id | `SALES_FACT.PRODUCT_ID` | MEASURE (SUM) |
| Sale Date | `SALES_FACT.SALE_DATE` | ATTRIBUTE (DATE) |
| Region | `SALES_FACT.REGION` | ATTRIBUTE |
| Sales Region | `SALES_FACT.SALES_REGION` | ATTRIBUTE |
| Segment | `SALES_FACT.SEGMENT` | ATTRIBUTE |
| Customer Email | `SALES_FACT.CUSTOMER_EMAIL` | ATTRIBUTE — the sensitive column for Level 5 |
| Tenant Code | `SALES_FACT.TENANT_CODE` | ATTRIBUTE — the RLS column |
| Revenue | `SALES_FACT.REVENUE` | MEASURE (SUM) |
| Cost | `SALES_FACT.COST` | MEASURE (SUM) |
| Product Name | `PRODUCT_DIM.PRODUCT_NAME` | ATTRIBUTE |
| Category | `PRODUCT_DIM.CATEGORY` | ATTRIBUTE |

**Renames used from Level 2 on:** in the copy, `SEGMENT` is named **`Customer Segment`**
and `REVENUE` is named **`Sales Amount`**. The expected column map is
`Customer Segment → Segment`, `Sales Amount → Revenue`.

## Level 1 — Happy path, smallest possible

Goal: prove the seven steps work end to end before adding any variation.

| # | Scenario | Setup | Expected | Answers |
|---|---|---|---|---|
| 1.1 | **Copy with no dependents** | Fixtures only | Step 1 `READY`; Step 2 zero dependents; publish; grants; nothing to repoint; delete | Q1, Q2, Q7, Q13, Q14, Q33 (no deps) |
| 1.2 | **One Answer on the copy** | + Answer on the copy, shared READ_ONLY to `org1_analysts` | Repointed in place; same GUID; same numbers; `org1_user` still sees it | Q25, Q26, Q27, Q29, Q30 |
| 1.3 | **One Liveboard** (2 visualizations, 1 Liveboard filter) | + Liveboard on the copy | Repointed as one object; filter works; layout disclosed | Q11, Q31 |
| 1.4 | **Copy shared to a group** | Copy shared READ_ONLY to `org1_analysts` | Published Model gets the same grant; `org1_user` can search it | Q21, Q23 |

## Level 2 — Column differences

Goal: the comparison and the rewrite. Uses 1.2 / 1.3 content.

| # | Scenario | Setup | Expected | Answers |
|---|---|---|---|---|
| 2.1 | **Renamed columns** | Copy uses `Customer Segment` and `Sales Amount`; an Answer and a Liveboard use both | `RENAME`; column map of 2; content rewritten; same numbers; users now see governed names (disclosed) | Q28 |
| 2.2 | **Renamed column inside a formula** | Answer formula `sum([Sales Amount]) / count([Sale Id])` | Formula rewritten; coverage gate clean | Q3 |
| 2.3 | **Qualified and decorated references** | Liveboard filter `<copy name>::Customer Segment`; `search_output_column` `Total Sales Amount` | Both forms rewritten | Q28 |
| 2.4 | **Chart state** | Chart with custom series colours and column properties on a renamed column | `client_state_v2` rewritten field by field; colours kept | — |
| 2.5 | **Label that matches a column name** | Visualization titled `Customer Segment` | Title **not** renamed | Q28 |
| 2.6 | **Missing column, unused** | Copy has an extra column no content uses | Warning only; migration proceeds | — |
| 2.7 | **Missing column, used** | Answer uses a copy-only column | `BLOCKED`, naming the Answer; nothing written | — |
| 2.8 | **Changed formula** | Copy's `Margin` is `[Sales Amount] - [Cost] * 1.1`; an Answer uses it | `BLOCKED` | Q3 |
| 2.10 | **Swapped names** | Copy names `SALES_REGION` **`Region`** and `REGION` **`Area`**. Map: `Region → Sales Region`, `Area → Region` | Renames applied **simultaneously**, not one after another — a sequential pass turns `Area` into `Region` and then into `Sales Region`. Same numbers per region | Q28 |
| 2.9 | **Extra columns in governed** | Governed has columns the copy lacks | Informational only | — |

## Level 3 — Model and publishing variations

| # | Scenario | Setup | Expected | Answers |
|---|---|---|---|---|
| 3.1 | **Copy has a different name** | Copy named `PRIMARYmodel – org1` | Paired by inputs, not name; `tables[].name` updated on repoint | Q26 |
| 3.2 | **Copy without the inherited `obj_id`** | Clear the copy's `obj_id` | `needs_rekey` false; 3b skipped; publish succeeds | — |
| 3.3 | **Case B — governed not parameterized** | Fresh governed Model | Variable created with the naming convention; Primary value set first; **Primary queries unaffected** | Q14, Q15 |
| 3.4 | **Case A — already published to another Org** | Governed already published to Org `org2` | Only org1's value added; org2 unaffected | Q15 |
| 3.5 | **Case A′ — conflicting value** | org1 already has a different value for the variable | Stop and ask; nothing written | Q15 |
| 3.6 | **Different table names** | Copy reads `ORG1_DATA.SALES_FACT_ORG1` instead of `SALES_FACT` *(needs a renamed copy of the table)* | `tableName` parameterized | Q14 |
| 3.7 | **Shared dimension** | Governed: `SALES_FACT` in `PRIMARY_DATA`, `PRODUCT_DIM` in `SHARED_DATA`. Copy: `SALES_FACT` in `ORG1_DATA`, `PRODUCT_DIM` in `SHARED_DATA` | Only the fact's schema differs → one variable for the fact; the dimension stays unparameterized and both Orgs read `SHARED_DATA` | Q13 |
| 3.8 | **Split variable needed** | Governed: both tables in `PRIMARY_DATA`. Copy: `SALES_FACT` in `ORG1_DATA`, `PRODUCT_DIM` in `SHARED_DATA` | One governed schema value maps to two copy values → case B: split into two variables; case A: stop | — |
| 3.8a | **Copy reads the same data as Primary** | Governed and copy both on `SHARED_DATA` | No values differ; reported as "org1 reads the same data as Primary, as the copy did" — no new exposure. Publish still needs a variable | Q13 |
| 3.9 | **Joins differ** | Copy changes a join's `on` clause; separately, same join written from the other side | First is a finding; second is **not** (cardinality normalised) | — |
| 3.10 | **Role-playing dimension** | `SALES_FACT` joins a date table twice (order date, ship date) *(needs a `DATE_DIM` table and two date keys)* | Stop at Step 1 | — |
| 3.11 | **RLS differs** | RLS rule on `TENANT_CODE` on the copy's `SALES_FACT`, not on governed | Security finding in the report | — |
| 3.12 | **Different warehouse account** | Copy's connection points at another account | 3a stops until connection-property handling is known | Q7, Q8 |

## Level 4 — Dependent topology

| # | Scenario | Setup | Expected | Answers |
|---|---|---|---|---|
| 4.1 | **View on the copy** | View on the copy + 2 Answers on the View | View repointed with exposed names kept; Answers untouched and still return data | Q10 |
| 4.2 | **Stacked Views** | View on a View on the copy | Only the bottom View rewritten; all content still works | Q10 |
| 4.3 | **Content directly on the copy's table** | Answer on the copy's `SALES_FACT` table | Reported, not migrated; copy's tables kept | Q6 |
| 4.4 | **Mixed Liveboard** | Liveboard with visualizations on the copy and on another Model that also has a `Customer Segment` column | Only the copy's visualizations rewritten | — |
| 4.5 | **Mixed Liveboard with a shared filter on a renamed column** | 4.4 + Liveboard filter on `Customer Segment` across both | Liveboard marked `MANUAL`; copy **not** deleted | — |
| 4.6 | **Set on the copy** | Set on the copy used by one Answer | `BLOCKED`; the Answer named; nothing written | — |
| 4.7 | **Set on the governed Model** | Set on governed | Publish refused with the Cohort error; nothing changed | — |
| 4.8 | **Large Liveboard** | Liveboard TML > 24,000 characters | Backup returned in slices; hash matches | Q30 |
| 4.9 | **Many dependents** | 50+ Answers on the copy | Batched export (~40 per run) and repoint (~8 per run) | — |

## Level 5 — Permissions and security

| # | Scenario | Setup | Expected | Answers |
|---|---|---|---|---|
| 5.1 | **Mixed grants** | Copy: `org1_analysts` READ_ONLY, explicit NO_ACCESS for `org1_user` (inside the group), `org1_viewer` MODIFY (user-level) | Published Model: group READ_ONLY, `org1_user` NO_ACCESS, `org1_viewer` READ_ONLY (downgrade disclosed). `org1_user` cannot see the Model despite the group | Q22 |
| 5.2 | **User sees an Answer, not the copy** | Copy shared to `org1_analysts`; the Answer also shared to `org1_viewer`, who is outside the group | Listed for the customer; with Strict Object Mode on, check what `org1_viewer` sees after the repoint | Q16, Q21 |
| 5.3 | **Access not lowered** | Published Model already MODIFY for a principal | Not lowered | — |
| 5.4 | **Column-level sharing on the copy** | `Customer Email` hidden from `org1_analysts` | Stop before Step 5 | Q17, Q24 |
| 5.5 | **Column Security Rule on the copy** | CSR on `Customer Email` on the copy | Stop before Step 5 | Q17 |
| 5.6 | **Non-admin verification** | Log in as `org1_user` after Step 5 | Content opens; org1 rows only | — |
| 5.7 | **Dependents' sharing survives** | Answer shared to `org1_viewer` before repoint | Same sharing after | Q29 |

## Level 6 — Wrong inputs, failures, rollback

| # | Scenario | Setup | Expected | Answers |
|---|---|---|---|---|
| 6.1 | **Both exports from the same Org** | Pass the governed export twice | Stop at 1a (equal GUIDs) | — |
| 6.2 | **Export without tables** | Model-only export | Stop at 1a | — |
| 6.3 | **Unparseable file** | Corrupt one file in the zip | Stop, naming the file | Q1 |
| 6.4 | **Stale export** | Edit the copy after exporting | Stop at 2a | — |
| 6.5 | **Admin in Primary only** | Migrating user not admin in org1 | Stop at 2a, not "zero dependents" | Q12 |
| 6.6 | **Edit during the window** | Edit an Answer between backup and import | Modified-time check stops Step 5 | Q19 |
| 6.7 | **Import fails mid-batch** | Make one object's import fail | Batch stops; earlier objects moved, later on copy; re-run resumes from the ledger | — |
| 6.8 | **Re-run everything** | Run the full migration twice | Second run writes nothing | — |
| 6.9 | **Rollback after Step 3** | Stop after publish | Unpublish, restore `obj_id`, remove value; estate as before | — |
| 6.10 | **Rollback after partial Step 5** | Stop after half the objects | Re-import backups; all on copy again | — |
| 6.11 | **Full rollback after Step 7** | Complete, then run the runbook | Copy restored with re-keyed `obj_id`; content back on it | Q4, Q34 |
| 6.12 | **Delete with dependents** (throwaway objects) | Call delete on a Model that still has an Answer | Record whether it refuses or cascades | Q33 |

## Level 7 — Several Orgs and downtime

| # | Scenario | Setup | Expected | Answers |
|---|---|---|---|---|
| 7.1 | **Two secondary Orgs in sequence** | Migrate org1, then org2 onto the same governed Model | org2 uses case A; org1 unaffected throughout | — |
| 7.2 | **Primary unaffected** | Run Primary content before and after 3.3 | Same numbers in Primary | — |
| 7.3 | **Downtime enforcement** | Try the proposed mechanism: block logins, `force-logout` an explicit list | Sessions ended for the listed users only, UI and embedded | Q18, Q20 |

## First test to run

**1.2 by hand**, before any script exists: one Answer on an identical copy. It exercises
every step once with the fewest moving parts, and answers the questions most likely to
change the design (Q2, Q7, Q14, Q25, Q26, Q29). Run each call through
`execute-thoughtspot-code`; `org_identifier` needs the `org-aware-code-exec` branch
deployed, otherwise use a session logged into each Org.

## Results

### 1.2 — Step 1 (2026-09-28, `nebula-test-27sep`, exports in `~/Documents/Migration_tool_demo`)

| Check | Result |
|---|---|
| Parse; manifests `OK` | Pass |
| One Model + Tables + Connection per export | Pass |
| Model GUIDs differ | Pass — `faea95b6-…` vs `fae510f4-…` (same first three characters; compare whole GUIDs) |
| Model tables carry `fqn` | **Yes (Q2)** — UI exports reference Tables by GUID |
| Table pairing | `SALES_FACT`, `PRODUCT_DIM`; overlap 1.0 |
| Differences | `schema` only: `PRIMARY_DATA` → `ORG1_DATA`, both Tables. Governed not parameterized (case B) |
| Connection | Names differ (`PRIMARYconn` / `ORG1conn`) — informational. Type `RDBMS_SNOWFLAKE`, account, user, role, warehouse, `selected_databases` identical → published connection reaches `ORG1_DATA` (role grant confirmed at 3d) |
| Columns | 12 + `Margin` matched; identity column map |
| Verdict | **READY** |
| `obj_id` | Model, both Tables and the Connection all inherited → re-key all (design updated) |
| Formula | Governed `Margin` has a trailing space the copy lacks — must normalise whitespace (design updated; Q3 partly answered) |

### Step 2 first pass (2026-09-28, org1 via `/bearer/mcp`)

| Check | Result |
|---|---|
| Sessions | `spottercode-org1` → org1 (2137347761), `spottercode-primary` → Primary (0); `tsadmin`, admin in both |
| Copy / governed `obj_id` | Both `PRIMARYmodel-faea95b6` — confirms Step 1 |
| Copy's dependents | **None** |
| Copy's Tables' dependents | Only the copy itself — the Table lookup must exclude the copy from "content on the copy's Tables" |
| Copy's sharing (`DEFINED`) | **None** |
| Fixtures missing on this cluster | `org1_analysts`, `org1_user`, `org1_viewer` |

### Basic scenario (1.2 + 1.4) — Step 2 (2026-09-28, org1)

| Check | Result |
|---|---|
| Copy | Model (`WORKSHEET`), not a published object, `obj_id` `PRIMARYmodel-faea95b6`, `modified` present in the header (ms epoch — Q19 partly) |
| File match | Live export agrees with the Step 1 file: 13 columns, same `Margin` formula, both Tables on `ORG1_DATA`. The REST JSON export omits `obj_id` and Connection files — the shared fingerprint must use only fields present in both |
| Dependents | 1: Answer **Revenue by Region** (`7e60f180-992d-4c86-82cd-a787552d328c`). V2 lookup groups it under **`QUESTION_ANSWER_BOOK`**, not `ANSWER` — the classifier must map internal type names |
| Usage | `search_query` `[Revenue] [Margin] by [Region]` → `Revenue`, `Margin`, `Region`; all `MATCHED` → only the Model reference changes |
| Answer TML | 5,831 characters — backup fits in one return |
| Sharing (`DEFINED`) | Copy: **`org1_user` (USER) READ_ONLY** — not the group. Answer: `org1_analysts` (GROUP) READ_ONLY. Author of both: `tsadmin` |
| Data fingerprint | 2 rows — EAST 236036 / 123268, WEST 259223 / 128171 (Revenue / Margin); SHA-256 `0b07f697…a22` |
| `crypto.subtle` in the sandbox | **Works (Q30)** |
| Verdict | **READY**; 1 object, Model reference swap only |

### Basic scenario — Step 3b (2026-09-28, org1, write)

| Object | GUID | Before | After |
|---|---|---|---|
| Copy Model | `fae510f4-…` | `PRIMARYmodel-faea95b6` | `PRIMARYmodel-faea95b6__copy_org1` |
| Copy `SALES_FACT` | `25154482-…` | `SALES_FACT-40639b92` | `SALES_FACT-40639b92__copy_org1` |
| Copy `PRODUCT_DIM` | `bbbb1ecd-…` | `PRODUCT_DIM-9f6ea9ff` | `PRODUCT_DIM-9f6ea9ff__copy_org1` |
| Copy connection `ORG1conn` | `679586c3-…` | `PRIMARYconn-deaca893` | `PRIMARYconn-deaca893__copy_org1` |

Both `update-obj-id` calls returned `204`; read-back confirmed. **`type: DATA_SOURCE` re-keys a connection.**
The endpoint takes `metadata_identifier` **or** `current_obj_id`, not both — the stale-value guard is a
read before the write. Rollback: the same calls with the old values.

### Basic scenario — Step 3a (2026-09-28, Primary, write)

| Action | Result |
|---|---|
| `variables/create` `TABLE_MAPPING` **with** `data_type` | `400` — *"Data type is not applicable for TABLE_MAPPING type of variable"* |
| `variables/create` without `data_type` | `200` — `primaryconn_primary_data_schema` (`a991fd59-c025-4711-a610-91562b74713e`); the platform also gives it an `obj_id` |
| ADD `PRIMARY_DATA` scoped to Primary; ADD `ORG1_DATA` scoped to org1 | `204`, `204`; read-back shows one value per Org |
| `parameterize` `schemaName` on both Tables | `204`, `204` — **Q14: the field name is `schemaName`** |
| Tables' TML after | `schema: ${primaryconn_primary_data_schema}` |
| Primary data after | Unchanged: NORTH 488997 / 292626, SOUTH 460567 / 274567 |

Rollback: unparameterize both Tables, then delete the variable.

### Basic scenario — Steps 3c–3d (2026-09-28)

| Check | Result |
|---|---|
| Publish (Model only, to org1, from Primary) | `204` |
| **Q7 — what follows the Model** | The Model, both Tables **and the connection** are published to org1. The connection is published but **not returned by `metadata/search` in org1** — confirmed in Atlas: `PRIMARYconn` has `orgId [0, 2137347761]`, `ownerOrgId 0`. The published Tables' `dataSourceId` is `PRIMARYconn` (`deaca893-…`) |
| Re-key (3b) | Needed for the Model, the Tables **and the connection** — the copy's `ORG1conn` carried `PRIMARYconn-deaca893` |
| Published Tables' TML in org1 | Exported live after the publish: `schema: ${primaryconn_primary_data_schema}`. TML shows the definition, not the per-Org value, so TML cannot answer Q13 — only a data read can |
| Copy | Present, `obj_id` `PRIMARYmodel-faea95b6__copy_org1` |
| `searchdata` on the published Model / Table in org1 | ❌ `400`, code 11020, *"Unable to fetch data: Invalid data source guid"* — possibly because the connection is not visible to org1-scoped lookups |
| `searchdata` by name in org1 | `409` `DUPLICATE_OBJECT_FOUND` — copy and published Model share the name; GUIDs only |
| UI search in org1 | ❌ Ref 10028. HAR: `AddColumns` → **Sage errorCode 5 FAILURE**, empty message. The session had both the published Model and the copy selected; the failing column was the published Model's `Cost` |
| Retry via API, later | ❌ 11020 again (incident `ee7eb3d9-8b98-486b-b779-e8e0e05653cf`). **Control: the copy, same query, same run → EAST / WEST ✅** |
| Blocker (temporary) | The published Model could not be queried in org1, by API or UI, while it worked in Primary. Incidents `316c7dd9-…`, `35157087-…`, `ee7eb3d9-…`. Steps 4–7 held; state stayed safe |
| **Root cause (Sage log)** | `sage/auto_complete/…WARNING…`, 05:25 UTC: `org_aware_metadata_snapshot.cpp:196] org_id: 2137347761 doesn't have access to table=faea95b6-…` → `request_validator.cpp:1198] … PERMISSION_DENIED_INACCESSIBLE_TO_ORG`. Sage's org-aware snapshot does not list org1 for the published Model. The Sage process started 02:59:40 UTC; the publish was ~05:14 |
| Atlas | Model `faea95b6-…` and `SALES_FACT` `40639b92-…`: `orgId [0, 2137347761]`, `ownerOrgId 0`, `modifiedMs` 05:08:23 UTC — the publish **was** recorded. So Sage's org-aware snapshot is stale: still refusing at 05:25, 17 minutes after |
| Resolution | **No restart.** Sage's indexing caught up on its own |
| **After indexing caught up** | Published Model in org1 → **EAST 236036 / 123268, WEST 259223 / 128171** — identical to the copy (control). Primary still NORTH / SOUTH. **Q13 answered: the variable resolves per Org; 3d passes** |
| **Finding** | **Sage indexing lags the publish.** Until it catches up, every search on the published Model in the secondary Org fails (`PERMISSION_DENIED_INACCESSIBLE_TO_ORG`; API 11020; UI Ref 10028). Observed: still failing ≥17 min after the publish, then resolved without intervention. 3d must wait and retry |

### Basic scenario — Step 4 (2026-09-28, org1)

| Check | Result |
|---|---|
| Copy's sharing (fresh) | `org1_analysts` (group) READ_ONLY |
| Published Model / Tables before | No sharing (admin-only) |
| Column Security Rules | Feature disabled on this cluster (`security/column/rules/fetch` → 403, "Column Security rule feature is disabled"); request needs `tables: [{identifier}]` |
| `share` without `message` | `400` — *"Variable $message of required type String! was not provided"* — nothing written |
| `share` with `message: ""` | `204` Tables, then `204` Model |
| Read-back (`DEFINED`) | Model, `SALES_FACT`, `PRODUCT_DIM`: `org1_analysts` `permission READ_ONLY`, `shared_permission NO_ACCESS` (as expected — read `permission`) |

### Basic scenario — Steps 5–6 (2026-09-28, org1)

| Check | Result |
|---|---|
| 5a Backup | Answer TML (YAML, 5,910 chars) returned in one piece; SHA-256 `a2a5d5b0…` matched locally; saved to `~/Documents/Migration_tool_demo/migration/org1/PRIMARYmodel/backup/7e60f180-….answer.tml` with `t0` 1790569266486 |
| 5b Rewrite | One change: `tables[0].fqn` copy → governed; `id` / `name` unchanged (same Model name); no column map |
| 5c Checks | `modified` = `t0`; copy GUID left 0×, governed GUID 1×; `VALIDATE_ONLY` → `OK` |
| 5d Import | `ALL_OR_NONE`, `create_new: false` → `OK`; same GUID; `fqn` now `faea95b6-…` (**Q25: YAML import updates in place with `create_new: false`**; **Q26: `fqn` swap alone is enough when names match**) |
| 6a Resolution | Copy's dependents: **none**. Published Model's dependents: the Answer |
| 6b Numbers | EAST 236036 / 123268, WEST 259223 / 128171 — SHA-256 equals Step 2's `0b07f697…` |
| 6c Sharing | Answer still `org1_analysts` READ_ONLY — **Q29 (sharing) survives an in-place import** |
| 6d Manual | **Pass** — `org1_user` opened the Answer: EAST / WEST, same numbers |

### Basic scenario — Step 7 (2026-09-28, org1)

| Check | Result |
|---|---|
| 7a Final sync | Copy: zero dependents; unchanged since the archive (13 columns, same `Margin`, both Tables on `ORG1_DATA`); sharing already carried |
| Rollback set | `migration/org1/PRIMARYmodel/inputs/` (both zips, `SHA256SUMS`) + `backup/7e60f180-….answer.tml` |
| 7b Model | Identity check passed (copy GUID, not published, `obj_id` `…__copy_org1`); `metadata/delete` → `204` |
| 7b Tables | Each then had zero dependents and passed the identity check; `metadata/delete` → `204`, `204` |
| 7b′ Connection | `ORG1conn`: zero dependents, identity check passed; **`connections/{id}/delete` → `204`** (`metadata/delete` has no connection type) |
| 7c Confirm | All four copy objects gone; published Model's dependents = the Answer; Answer data EAST 236036 / 123268, WEST 259223 / 128171 |

**Result: the basic scenario passes end to end.** `org1_user` sees the same numbers on the
published Model, the Answer kept its GUID and sharing, and the copy with its Tables and
connection is gone.
