# TML Fields the Builder Reads

The subset of Model and Table TML that `scripts/erd_parser.ts` uses, and what it does
with each field. Extracted from the thoughtspot-agent-skills schema references
(`thoughtspot-model-tml.md`, `thoughtspot-table-tml.md`). Everything else in the TML is
ignored. Field names are the same in JSON and YAML TML; in YAML the join condition key is
quoted (`'on':`), in JSON it is plain `"on"`. The parser accepts both.

---

## Model TML

```json
{
	"guid": "{model_guid}",
	"model": {
		"name": "Sales",
		"description": "...",
		"model_tables": [
			{
				"name": "ORDERS",
				"fqn": "{table_guid}",
				"joins": [
					{ "with": "CUSTOMER", "referencing_join": "ORDERS_to_CUSTOMER" },
					{
						"with": "REGION",
						"on": "[ORDERS::REGION_ID] = [REGION::ID]",
						"type": "LEFT_OUTER",
						"cardinality": "MANY_TO_ONE"
					}
				]
			},
			{ "name": "CUSTOMER", "fqn": "{table_guid}" },
			{ "name": "CUSTOMER", "alias": "SHIP_TO", "fqn": "{table_guid}" }
		],
		"formulas": [
			{ "id": "formula_Revenue", "name": "Revenue", "expr": "sum ( [ORDERS::AMOUNT] )" }
		],
		"columns": [
			{
				"name": "Amount",
				"column_id": "ORDERS::AMOUNT",
				"properties": { "column_type": "MEASURE", "aggregation": "SUM" }
			},
			{
				"name": "Revenue",
				"formula_id": "formula_Revenue",
				"properties": { "column_type": "MEASURE" }
			}
		]
	}
}
```

| Field                                   | Used for                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `guid`                                  | Model identity; key for the AI-analysis corpus                                                                                  |
| `model.name`, `model.description`       | ERD title and Model panel                                                                                                       |
| `model_tables[].name`                   | Node id, unless `alias` is set. Also the key used to find the Table TML                                                         |
| `model_tables[].alias`                  | Node id for a second (or later) instance of the same physical table. The node records `alias_of` = `name`                       |
| `model_tables[].fqn`                    | Table GUID (with `export_fqn`). Table TMLs are matched by this first, then by name                                              |
| `model_tables[].joins[].with`           | Join target: the `name` or `alias` of another `model_tables` entry. A target not in the Model is dropped and logged             |
| `joins[].referencing_join`              | A join defined in the source Table TML's `joins_with`. Cardinality, type and `on` come from there (origin `table`, badge **T**) |
| `joins[].on`, `type`, `cardinality`     | An inline, model-local join (origin `model`, badge **M**), named `{from}_{to}`                                                  |
| `formulas[].name`, `expr`               | Formula list. A formula column is drawn on the first model table its `expr` references as `[TABLE::col]`                        |
| `columns[].column_id`                   | `TABLE::col`. The prefix (table `name` or `alias`) decides which node shows the column                                          |
| `columns[].formula_id`                  | Marks a formula column (ƒ role)                                                                                                 |
| `properties.column_type`, `aggregation` | `MEASURE` vs attribute, and the aggregation badge                                                                               |
| `properties.is_hidden`                  | Hidden columns. A hidden measure does not make a table a fact                                                                   |
| `properties.ai_context`, `synonyms`     | Shown in the column inspector (top-level `synonyms` is the fallback)                                                            |
| `columns[].description`                 | Column description in the inspector                                                                                             |

**Table kind.** A table is a **fact** if it has a visible measure column; a **bridge** if
it has none but both receives and emits a join; otherwise a **dimension**.

---

## Table TML

```json
{
	"guid": "{table_guid}",
	"table": {
		"name": "ORDERS",
		"joins_with": [
			{
				"name": "ORDERS_to_CUSTOMER",
				"destination": { "name": "CUSTOMER" },
				"on": "[ORDERS::CUSTOMER_CODE] = [CUSTOMER::CUSTOMER_CODE]",
				"type": "INNER",
				"cardinality": "MANY_TO_ONE"
			}
		],
		"rls_rules": {
			"tables": [{ "name": "ORDERS" }],
			"table_paths": [{ "id": "T_1", "table": "ORDERS", "column": "[OWNER]" }],
			"rules": [{ "name": "Own rows", "expr": "[T_1::OWNER] = ts_username" }]
		}
	}
}
```

| Field                                           | Used for                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `guid`, `table.name`                            | Matching to `model_tables[].fqn` / `name`. A different `table.name` than the node id marks the node as an alias       |
| `joins_with[].name`                             | Matched against `referencing_join`                                                                                    |
| `joins_with[].on`, `type`, `cardinality`        | Join detail. Every `[TABLE::col]` in an `on` clause is flagged as a join key (added as a hidden column if not listed) |
| `rls_rules` (list, or `{rules: [...]}`)         | RLS rules on the node: `name`, `expr` or `expression`, `applies_to` or `scope`                                        |
| a table named in another table's RLS expression | Marks that table **in RLS path** (amber)                                                                              |

RLS expressions written against `table_paths` aliases (`[T_1::COL]`) name the alias, not
a table, so they don't mark any other table as in the RLS path (open item 5).

---

## SQL view TML

A `sql_view` TML (`{"sql_view": {"name", "sql_query", ...}}`) marks a node as a SQL view
and carries its query, **when it is handed to the parser directly**. The builder
only routes `model` and `table` TML, as the CLI original did, so SQL views in an export
are not picked up (open item 5).
