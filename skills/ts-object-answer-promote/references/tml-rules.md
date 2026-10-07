# TML Rules for Promotion

Condensed from the thoughtspot-agent-skills shared schemas (`thoughtspot-answer-tml.md`
and `thoughtspot-model-tml.md`). Only the parts that matter for moving formulas and
parameters from an Answer into a Model are included. `scripts/promote_formulas.ts`
already applies every rule here. This file is for reading import errors, not for
merging by hand.

---

## Answer TML vs. Model TML

| Aspect             | Answer TML                                          | Model TML                                                     |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------- |
| Formula entry      | `formulas[]: {id, name, expr, was_auto_generated?}` | `formulas[]: {id, name, expr}`                                |
| `column_type`      | Absent, so it has to be inferred                    | On the matching `columns[]` entry, under `properties`         |
| `aggregation`      | Absent                                              | On `columns[].properties` only. **Never on `formulas[]`**     |
| Column references  | Bare display name `[Revenue]`                       | `[TABLE::col]`, where TABLE is a `model_tables[]` name/alias  |
| Formula references | `[formula_<Name>]` (the id)                         | `[formula_<Name>]` (the id). Display-name refs fail on import |
| Parameters         | `answer.parameters[]`, scoped to the Answer         | `model.parameters[]`, reusable                                |
| Sets               | `answer.cohorts[]`                                  | Not in Model TML                                              |
| Data source        | `answer.tables[0].fqn` is the Model GUID            | `model_tables[].fqn` are the Table GUIDs                      |

`guid` is always at the document root, beside `answer:`/`model:`, never inside them.

---

## Model formulas and columns

- Every formula needs a `columns[]` entry pointing at it via `formula_id`. A formula
  with no column is not surfaced.
- `formula_id` must match `formulas[].id` exactly (case-sensitive, spaces included). The
  convention is `formula_<Name>`.
- `column_type` is `MEASURE` if the expression calls an aggregate (`sum`, `count`,
  `unique count`, `average`, `min`, `max`, `group_*`, `cumulative_*`, `moving_*`,
  `rank`, `last_value`, `first_value`, ...), otherwise `ATTRIBUTE`.
- For a MEASURE formula column, `aggregation: SUM` is the convention. ThoughtSpot ignores
  it at query time, because the expression is self-contained.
- Display names must be unique across `columns[]` and `formulas[]`.

```json
{
	"formulas": [
		{
			"id": "formula_Profit",
			"name": "Profit",
			"expr": "sum ( [ORDERS::REVENUE] ) - sum ( [ORDERS::COST] )"
		}
	],
	"columns": [
		{
			"name": "Profit",
			"formula_id": "formula_Profit",
			"properties": { "column_type": "MEASURE", "aggregation": "SUM" }
		}
	]
}
```

---

## Model parameters

| Field                  | Notes                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `id`                   | Omit when promoting. The Answer's UUID is dropped, and ThoughtSpot assigns a new one     |
| `name`                 | Referenced in formulas as `[Name]`, with no `TABLE::` prefix                             |
| `data_type`            | `INT64`, `DOUBLE`, `CHAR`, `DATE`, `BOOL`. `VARCHAR` fails on import for list parameters |
| `default_value`        | Always a string, whatever the `data_type`                                                |
| `dynamic_default_date` | For example `TODAY`. Used instead of `default_value` on some DATE parameters             |
| `list_config`          | `list_choice[]` of `{value, display_name}` objects. Bare strings are rejected            |
| `range_config`         | `range_min`, `range_max`, `include_min`, `include_max`                                   |

Only one of `list_config` or `range_config` may be present.

---

## Common import errors

| Error                                               | Cause                                                        | Fix                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `FORMULA is not a valid aggregation type`           | `aggregation` on a `formulas[]` entry                        | Move it to the matching `columns[]` entry. The script never emits this, so check for a manual edit |
| `duplicate column name {name}`                      | A promoted name clashes with an existing physical column     | Rename the formula with `exprOverrides`, or skip it                                                |
| `column_id not found` / `Search did not find '{x}'` | A reference in the expression doesn't resolve                | Map it with `refOverrides` (Step 7) and re-run                                                     |
| `No enum constant ColumnTypeEnum`                   | `column_type` not under `properties`                         | Nest it under `properties`                                                                         |
| `parameter not found`, or the formula returns NULL  | The parameter name doesn't match a `model.parameters[].name` | Names are case-sensitive. Promote the parameter (option P), or fix the name                        |
| `Found multiple data sources with same name`        | The TML was exported without `export_fqn`                    | Re-export with `export_fqn: true`                                                                  |
| A second Model appears instead of an update         | `guid` missing or nested, or `create_new` was not false      | The script puts `guid` at the root. Check the import body                                          |
| `dynamic_default_date` rejected                     | Older instance without Model-level dynamic defaults          | Replace it with a static `default_value`                                                           |
