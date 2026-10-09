/**
 * Assemble parsed models into a single ERD bundle for the renderer.
 *
 * Port of thoughtspot-agent-skills `agents/shared/erd/erd_data.py`. `slice` keeps
 * Python's slicing semantics for the model cap (including a negative cap).
 */
import type { ErdModel, Log } from './erd_parser';

export interface ErdSummary {
	name: unknown;
	guid: unknown;
	tables: number;
	joins: number;
	findings: number;
	rls: number;
}

export interface ErdBundle {
	models: ErdModel[];
	index: ErdSummary[];
	dropped: unknown[];
}

export function summary(model: ErdModel): ErdSummary {
	const rls = model.tables.reduce((n, t) => n + (t.rls ?? []).length, 0);
	return {
		name: model.model.name,
		guid: model.model.guid,
		tables: model.tables.length,
		joins: model.joins.length,
		findings: (model.findings ?? []).length,
		rls,
	};
}

export function redact(model: ErdModel): ErdModel {
	const copy = structuredClone(model);
	for (const t of copy.tables) {
		for (const rule of t.rls ?? []) rule.expr = '(redacted)';
	}
	return copy;
}

export function assemble(
	models: ErdModel[],
	opts: { maxModels?: number; redactRls?: boolean; log?: Log } = {},
): ErdBundle {
	const { maxModels = 25, redactRls = false, log } = opts;
	let kept = models.slice(0, maxModels);
	const dropped = models.slice(maxModels).map((m) => m.model.name);
	if (dropped.length && log) {
		log(
			`Model cap reached (${maxModels}): dropped ${dropped.length} model(s): ${dropped.join(', ')}`,
		);
	}
	if (redactRls) kept = kept.map(redact);
	return { models: kept, index: kept.map(summary), dropped };
}
