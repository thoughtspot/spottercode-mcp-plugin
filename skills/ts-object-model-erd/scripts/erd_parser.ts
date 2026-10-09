/**
 * Parse ThoughtSpot Model + Table TML into the ERD MODEL schema.
 *
 * Function-for-function port of thoughtspot-agent-skills
 * `agents/shared/erd/parser.py` (ts-object-model-erd 1.7.1). Each Python helper
 * keeps its name (camelCased) and behaviour; Python truthiness and `dict.get`
 * semantics are reproduced with `truthy`/`or`/`get` so empty lists, empty objects
 * and explicit nulls behave exactly as they did.
 *
 * TML is handled as parsed JSON: export with `edoc_format: "JSON"`. There is no
 * YAML parser here (no npm dependencies), so `loadTml` rejects YAML with a clear
 * error instead of guessing.
 *
 * Deliberate differences: a missing or null container (`model`, `table`,
 * `model_tables`, `formulas`, `columns`) is treated as empty instead of raising,
 * where the Python would have thrown a TypeError.
 */
import fs from 'fs';

// Loose TML shape: every field is optional and unknown fields pass through.
export type Tml = Record<string, unknown>;
export type Log = (msg: string) => void;

export interface ErdColumn {
	name: unknown;
	src: unknown;
	role: 'FORMULA' | 'MEASURE' | 'ATTR';
	agg: unknown;
	is_measure?: boolean;
	key: boolean;
	hidden: boolean;
	flag: null;
	desc?: unknown;
	ai_context?: unknown;
	synonyms?: unknown;
}

export interface ErdRule {
	name: unknown;
	expr: unknown;
	scope: unknown;
}

export interface ErdTable {
	id: string;
	kind: 'fact' | 'bridge' | 'dim';
	cols: ErdColumn[];
	rls: ErdRule[];
	is_sql_view: boolean;
	sql_query: unknown;
	alias_of: unknown;
	in_rls_path: boolean;
}

export interface ErdJoin {
	from: string;
	to: string;
	name: string;
	card: unknown;
	origin: 'model' | 'table';
	type: unknown;
	on: unknown;
}

export interface ErdModel {
	model: {
		name: unknown;
		guid: unknown;
		description: unknown;
		ai_analysis?: unknown;
		ai_instructions?: unknown;
	};
	tables: ErdTable[];
	joins: ErdJoin[];
	formulas: Record<string, unknown>;
	findings: unknown[];
}

// --- Python semantics helpers ---

/** Python truthiness: None/False/0/""/[]/{} are falsy. */
export function truthy(v: unknown): boolean {
	if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
	if (typeof v === 'number' && Number.isNaN(v)) return false;
	if (Array.isArray(v)) return v.length > 0;
	if (typeof v === 'object') return Object.keys(v as object).length > 0;
	return true;
}

/** Python `a or b or c`: the first truthy value, else the last one. */
export function or(...vals: unknown[]): unknown {
	for (const v of vals) if (truthy(v)) return v;
	return vals[vals.length - 1];
}

export function isDict(v: unknown): v is Tml {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Python `d.get(key, default)`: an explicit null is returned as-is; only a missing key falls back. */
export function get(d: unknown, key: string, dflt: unknown = undefined): unknown {
	if (isDict(d) && Object.prototype.hasOwnProperty.call(d, key)) {
		const v = d[key];
		return v === undefined ? null : v;
	}
	return dflt === undefined ? null : dflt;
}

/** `d.get(key, {})` that tolerates a null value (Python would raise on `.get` of None). */
function getDict(d: unknown, key: string): Tml {
	const v = get(d, key, {});
	return isDict(v) ? v : {};
}

/** `d.get(key, [])` that tolerates a null or non-list value. */
function getList(d: unknown, key: string): unknown[] {
	const v = get(d, key, []);
	return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

// --- parser.py ---

const COLREF = /\[([^\]]+?)::[^\]]+?\]/g;
const ONREF = /\[([^\]]+?)::([^\]]+?)\]/g;

/** Load a TML file into an object. JSON only: YAML TML throws (re-export with edoc_format JSON). */
export function loadTml(filePath: string): Tml {
	const raw = fs.readFileSync(filePath, 'utf8');
	try {
		return JSON.parse(raw) as Tml;
	} catch {
		throw new Error(
			`${filePath} is not JSON (it looks like YAML TML). This builder reads JSON TML only: ` +
				'export with edoc_format "JSON", or convert the file to JSON.',
		);
	}
}

function colrefTables(expr: string): string[] {
	return [...expr.matchAll(COLREF)].map((m) => m[1]);
}

export function tableOfColumnId(columnId: string): string {
	return columnId.includes('::') ? columnId.split('::', 1)[0] : '';
}

export function primaryTableOfFormula(expr: unknown, knownTables: Set<unknown>): string {
	for (const tbl of colrefTables(str(or(expr, '')))) {
		if (knownTables.has(tbl)) return tbl;
	}
	return '';
}

export function columnRole(props: Tml, isFormula: boolean): ErdColumn['role'] {
	if (isFormula) return 'FORMULA';
	return get(props, 'column_type') === 'MEASURE' ? 'MEASURE' : 'ATTR';
}

interface TableJoin {
	card: unknown;
	type: unknown;
	on: unknown;
}

export function indexTableJoins(tableTmls: Map<unknown, Tml>): Map<unknown, TableJoin> {
	const out = new Map<unknown, TableJoin>();
	for (const tdict of tableTmls.values()) {
		const tbl = getDict(tdict, 'table');
		const joinsWith = or(get(tbl, 'joins_with', []), []);
		for (const jw of Array.isArray(joinsWith) ? joinsWith : []) {
			out.set(get(jw, 'name'), {
				card: get(jw, 'cardinality', 'UNKNOWN'),
				type: get(jw, 'type', 'UNKNOWN'),
				on: or(get(jw, 'on'), get(jw, "'on'"), ''),
			});
		}
	}
	return out;
}

/**
 * Build the renderer-facing column entry, including AI-authored metadata.
 *
 * Top-level `description`/`synonyms` are usually null; the real content lives
 * under `properties` (ai_context, synonyms), so fall back to those.
 */
export function columnEntry(col: Tml, props: Tml, isFormula: boolean, src: unknown): ErdColumn {
	return {
		name: get(col, 'name', ''),
		src,
		role: columnRole(props, isFormula),
		agg: get(props, 'aggregation'),
		is_measure: get(props, 'column_type') === 'MEASURE',
		key: false,
		hidden: truthy(get(props, 'is_hidden', false)),
		flag: null,
		desc: or(get(col, 'description'), ''),
		ai_context: or(get(props, 'ai_context'), ''),
		synonyms: or(get(props, 'synonyms'), get(col, 'synonyms'), []),
	};
}

/**
 * Normalise a table's rls_rules to a list of rule objects.
 *
 * Some builds nest the rule list under an object:
 *     rls_rules: {rules: [...], table_paths: [...], tables: [...]}
 * while others emit a flat list of rule objects.
 */
export function rlsRuleList(tdict: Tml): Tml[] {
	let raw = or(get(getDict(tdict, 'table'), 'rls_rules'), []);
	if (isDict(raw)) raw = or(get(raw, 'rules'), []);
	return (Array.isArray(raw) ? raw : []).filter(isDict);
}

export function rlsForTable(tdict: Tml): ErdRule[] {
	return rlsRuleList(tdict).map((r) => ({
		name: get(r, 'name', 'RLS rule'),
		expr: or(get(r, 'expression'), get(r, 'expr'), ''),
		scope: or(get(r, 'applies_to'), get(r, 'scope'), 'All users'),
	}));
}

export function keysFromOn(onExpr: unknown): [string, string][] {
	return [...str(or(onExpr, '')).matchAll(ONREF)].map((m) => [m[1], m[2]]);
}

/**
 * Node identity for a model_table.
 *
 * A model may join the SAME physical table multiple times; each instance is
 * distinguished by an `alias`. When present the alias is the node identity and
 * is what a join's `with:` references — the un-aliased `name` is the shared
 * physical table. Keying every node by alias-or-name is what lets aliased join
 * endpoints resolve to a real node instead of dangling.
 */
export function tableNodeId(mt: Tml): string {
	return or(get(mt, 'alias'), get(mt, 'name')) as string;
}

export function buildFormulas(model: Tml): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const f of getList(model, 'formulas')) {
		// json.dumps writes a None key as "null"
		out[String(get(f, 'name') ?? 'null')] = get(f, 'expr', '');
	}
	return out;
}

/** Route each model column to its owning node (by alias-or-name prefix). */
export function buildColumns(
	model: Tml,
	tableIds: string[],
	formulas: Record<string, unknown>,
): Map<unknown, ErdColumn[]> {
	const colsByTable = new Map<unknown, ErdColumn[]>(tableIds.map((tid) => [tid, []]));
	const known = new Set<unknown>(tableIds);
	for (const colRaw of getList(model, 'columns')) {
		const col = isDict(colRaw) ? colRaw : {};
		const propsRaw = or(get(col, 'properties', {}), {});
		const props = isDict(propsRaw) ? propsRaw : {};
		const isFormula = Object.prototype.hasOwnProperty.call(col, 'formula_id');
		let owner: unknown;
		let src: unknown;
		if (isFormula) {
			const name = get(col, 'name');
			const expr = Object.prototype.hasOwnProperty.call(formulas, String(name ?? 'null'))
				? formulas[String(name ?? 'null')]
				: '';
			owner = primaryTableOfFormula(expr, known);
			src = 'formula';
		} else {
			owner = tableOfColumnId(str(get(col, 'column_id', '')));
			src = get(col, 'column_id', '');
		}
		colsByTable.get(owner)?.push(columnEntry(col, props, isFormula, src));
	}
	return colsByTable;
}

/**
 * Build model-local joins, keeping only those whose endpoints are both real
 * nodes. A join's `with:` target absent from `model_tables` cannot occur in a
 * valid ThoughtSpot export, so this only guards malformed/hand-edited TML. Such
 * a join is dropped (and reported via the returned `dropped` names) rather than
 * emitted with a non-existent endpoint.
 */
export function buildJoins(
	modelTables: Tml[],
	nodeIds: Set<unknown>,
): { joins: ErdJoin[]; dropped: string[] } {
	const joins: ErdJoin[] = [];
	const dropped: string[] = [];
	for (const mt of modelTables) {
		const frm = tableNodeId(mt);
		const mtJoins = or(get(mt, 'joins', []), []);
		for (const j of Array.isArray(mtJoins) ? mtJoins : []) {
			const to = get(j, 'with', '') as string;
			const refJoin = get(j, 'referencing_join', '');
			const inlineOn = or(get(j, 'on'), '');
			let rec: ErdJoin;
			if (truthy(refJoin)) {
				rec = {
					from: frm,
					to,
					name: refJoin as string,
					card: 'UNKNOWN',
					origin: 'model',
					type: 'UNKNOWN',
					on: '',
				};
			} else if (truthy(inlineOn)) {
				rec = {
					from: frm,
					to,
					name: `${frm}_${to}`,
					card: get(j, 'cardinality', 'UNKNOWN'),
					origin: 'model',
					type: get(j, 'type', 'UNKNOWN'),
					on: inlineOn,
				};
			} else {
				continue;
			}
			if (nodeIds.has(to) && nodeIds.has(frm)) joins.push(rec);
			else dropped.push(rec.name);
		}
	}
	return { joins, dropped };
}

/**
 * Classify a table. Fact only when it carries real (visible) measures — an
 * outgoing join alone does not make a fact; a measureless table that both
 * receives and emits a join is a bridge; anything else is a dimension.
 */
export function tableKind(
	cols: ErdColumn[],
	tid: unknown,
	isTarget: Set<unknown>,
	hasOutgoing: Set<unknown>,
): ErdTable['kind'] {
	if (cols.some((c) => c.is_measure && !c.hidden)) return 'fact';
	if (isTarget.has(tid) && hasOutgoing.has(tid)) return 'bridge';
	return 'dim';
}

/** Upgrade model-local joins with cardinality/type/origin from Table TMLs. */
export function stitchTableJoins(joins: ErdJoin[], tableJoins: Map<unknown, TableJoin>): void {
	for (const j of joins) {
		const tj = tableJoins.get(j.name);
		if (tj) {
			j.origin = 'table';
			j.card = tj.card;
			j.type = tj.type;
			j.on = tj.on ?? '';
		}
	}
}

/**
 * Attach RLS, SQL-view and alias metadata from the physical Table TMLs.
 *
 * Table TMLs are keyed by physical table name; an aliased node's physical name
 * is `physById[tid]`, so look up by that first, then fall back to the node id.
 */
export function enrichFromTableTmls(
	tablesById: Map<unknown, ErdTable>,
	physById: Map<unknown, unknown>,
	tableTmls: Map<unknown, Tml>,
): void {
	for (const [tid, t] of tablesById) {
		const phys = physById.has(tid) ? physById.get(tid) : tid;
		const tdict = or(tableTmls.get(phys) ?? null, tableTmls.get(tid) ?? null) as Tml | null;
		if (!truthy(tdict)) continue;
		const td = tdict as Tml;
		t.rls = rlsForTable(td);
		if (Object.prototype.hasOwnProperty.call(td, 'sql_view')) {
			t.is_sql_view = true;
			t.sql_query = or(get(getDict(td, 'sql_view'), 'sql_query'), '');
		}
		const physName = or(
			get(getDict(td, 'table'), 'name'),
			get(getDict(td, 'sql_view'), 'name'),
		);
		if (truthy(physName) && physName !== tid && !truthy(t.alias_of)) t.alias_of = physName;
	}
}

/** Flag (or synthesize) the columns that participate in join ON clauses. */
export function applyJoinKeys(tablesById: Map<unknown, ErdTable>, onExprs: unknown[]): void {
	for (const onExpr of onExprs) {
		for (const [tbl, col] of keysFromOn(onExpr)) {
			const t = tablesById.get(tbl);
			if (!t) continue;
			const existing = t.cols.find((c) => c.name === col);
			if (existing) {
				existing.key = true;
			} else {
				t.cols.push({
					name: col,
					src: col,
					role: 'ATTR',
					agg: null,
					key: true,
					hidden: true,
					flag: null,
				});
			}
		}
	}
}

/** Flag tables referenced by another table's RLS rule expression. */
export function markRlsPath(tables: ErdTable[], tableTmls: Map<unknown, Tml>): void {
	const rlsReferenced = new Set<string>();
	for (const [tname, tdict] of tableTmls) {
		for (const rule of rlsRuleList(tdict)) {
			const expr = or(get(rule, 'expression'), get(rule, 'expr'), '');
			for (const refTable of colrefTables(str(expr))) {
				if (refTable !== tname) rlsReferenced.add(refTable);
			}
		}
	}
	for (const t of tables) t.in_rls_path = rlsReferenced.has(t.id);
}

export function logDroppedJoins(dropped: string[], log?: Log): void {
	if (log && dropped.length) {
		log(
			`Dropped ${dropped.length} join(s) whose target table is not in the model — this ` +
				'cannot occur in a valid ThoughtSpot export and indicates malformed ' +
				`TML: ${[...dropped].sort().join(', ')}`,
		);
	}
}

export function logDegradedFidelity(
	joins: ErdJoin[],
	tableJoins: Map<unknown, TableJoin>,
	log?: Log,
): void {
	if (!log) return;
	const referenced = new Set(joins.map((j) => j.name));
	if (referenced.size && !tableJoins.size) {
		log(
			'Fidelity degraded: no Table TMLs provided — join cardinality/type/' +
				`origin and RLS omitted for all ${referenced.size} join(s).`,
		);
		return;
	}
	const missing = [...referenced].filter((n) => truthy(n) && !tableJoins.has(n)).sort();
	if (missing.length) {
		log(
			`Fidelity degraded: ${missing.length} join(s) had no Table TML definition ` +
				`(treated as model-local, cardinality unknown): ${missing.join(', ')}`,
		);
	}
}

/**
 * Parse one Model TML (plus the Table TMLs it needs, keyed by the model_table
 * `name`) into the renderer's model schema.
 */
export function parseModel(
	modelTml: Tml,
	tableTmlsIn: Map<unknown, Tml> | Record<string, Tml>,
	log?: Log,
): ErdModel {
	const tableTmls =
		tableTmlsIn instanceof Map
			? tableTmlsIn
			: new Map<unknown, Tml>(Object.entries(tableTmlsIn));
	const model = getDict(modelTml, 'model');
	const guid = get(modelTml, 'guid', '');
	const modelTables = (or(get(model, 'model_tables', []), []) as unknown[]).filter(isDict);

	const tableIds = [...new Set(modelTables.map(tableNodeId))];
	const physById = new Map<unknown, unknown>(
		modelTables.map((mt) => [tableNodeId(mt), get(mt, 'name')]),
	);
	const aliasIds = new Set(modelTables.filter((mt) => truthy(get(mt, 'alias'))).map(tableNodeId));

	const formulas = buildFormulas(model);
	const colsByTable = buildColumns(model, tableIds, formulas);
	const { joins, dropped } = buildJoins(modelTables, new Set(tableIds));
	logDroppedJoins(dropped, log);

	const hasOutgoing = new Set(
		modelTables.filter((mt) => truthy(get(mt, 'joins'))).map(tableNodeId),
	);
	const isTarget = new Set<unknown>(joins.map((j) => j.to));
	// An explicit `alias` instance records its physical table up front (even
	// without a Table TML); a non-aliased node may still be resolved as an alias
	// in enrichFromTableTmls if its Table TML's physical name differs.
	const tables: ErdTable[] = tableIds.map((tid) => ({
		id: tid,
		kind: tableKind(colsByTable.get(tid) ?? [], tid, isTarget, hasOutgoing),
		cols: colsByTable.get(tid) ?? [],
		rls: [],
		is_sql_view: false,
		sql_query: null,
		alias_of: aliasIds.has(tid) ? (physById.get(tid) ?? null) : null,
		in_rls_path: false,
	}));

	const tableJoins = indexTableJoins(tableTmls);
	stitchTableJoins(joins, tableJoins);

	const tablesById = new Map<unknown, ErdTable>(tables.map((t) => [t.id, t]));
	enrichFromTableTmls(tablesById, physById, tableTmls);

	const onExprs: unknown[] = [...tableJoins.values()].map((meta) => meta.on);
	onExprs.push(...joins.filter((j) => truthy(j.on)).map((j) => j.on));
	applyJoinKeys(tablesById, onExprs);

	markRlsPath(tables, tableTmls);
	logDegradedFidelity(joins, tableJoins, log);

	return {
		model: { name: get(model, 'name', ''), guid, description: get(model, 'description', '') },
		tables,
		joins,
		formulas,
		findings: [],
	};
}
