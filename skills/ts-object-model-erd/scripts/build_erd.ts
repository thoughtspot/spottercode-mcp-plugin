#!/usr/bin/env -S npx tsx
/**
 * CLI: discover Model + Table TMLs, parse, assemble, render an ERD HTML file.
 *
 *   npx tsx build_erd.ts <src...> [--out model_erd.html] [--max-models 25]
 *                        [--redact-rls] [--ai-analysis corpus.json]
 *
 * Port of thoughtspot-agent-skills `agents/cli/ts-object-model-erd/build_erd.py`
 * (1.7.1). Sources may be, in any mix:
 *   - an **export metadata TML** response saved as JSON: the raw array of
 *     `{"edoc": "<tml string>", "info": {...}}` elements, a single such element,
 *     or already-parsed TML (`{"edoc": {...}}` or a bare TML object).
 *   - individual `.tml` / `.yaml` / `.yml` / `.json` files holding JSON TML, or a
 *     directory of them (walked recursively).
 *
 * Model vs. table is decided by TML content (the `model` / `table` key), never by
 * filename.
 *
 * Differences from the Python original (deliberate):
 *   - No YAML parser (the skill scripts carry no npm dependencies). A source file
 *     that isn't JSON stops the build with a message naming it and saying to
 *     export with edoc_format "JSON". An `edoc` string inside a JSON export that
 *     isn't JSON is skipped with a log line.
 *   - `<` in the embedded data is escaped (see render.ts).
 *
 * Needs a local shell with Node (`npx tsx`); it reads and writes local files.
 */
import fs from 'fs';
import path from 'path';
import { get, isDict, parseModel, truthy, type ErdModel, type Log, type Tml } from './erd_parser';
import { assemble } from './erd_data';
import { writeHtml } from './render';

const TML_EXTS = ['.tml', '.yaml', '.yml'];

/** The builder stops with this error; the CLI prints the message and exits 1. */
export class BuildError extends Error {}

const yamlHelp =
	'This builder reads JSON TML only. Export with edoc_format "JSON" (the skill does this), ' +
	'or convert the file(s) to JSON first.';

/**
 * Return a parsed TML object from a value that may be an object or a TML string.
 *
 * Accepts the raw export shape (`{"edoc": "<tml>"}`) and the parsed shape
 * (`{"edoc": {...}}` or a bare TML object). Returns null for anything that isn't
 * a recognisable Model or Table TML.
 */
export function coerceTml(obj: unknown, log?: Log): Tml | null {
	if (typeof obj === 'string') {
		try {
			obj = JSON.parse(obj);
		} catch {
			log?.(
				'Skipping an edoc that is not JSON (YAML TML?). Re-export with edoc_format "JSON" to include it.',
			);
			return null;
		}
	}
	if (!isDict(obj)) return null;
	const isTml = 'model' in obj || 'table' in obj;
	// The export response wraps each TML under `edoc` (a string when raw, an object when parsed).
	if ('edoc' in obj && !isTml) return coerceTml(obj.edoc, log);
	return isTml ? obj : null;
}

/** Parsed TML objects from one file (a JSON export dump or a single TML). */
export function loadSourceFile(filePath: string, log?: Log): Tml[] {
	const raw = fs.readFileSync(filePath, 'utf8');
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new YamlSourceError(filePath);
	}
	const items = Array.isArray(data) ? data : [data];
	const out: Tml[] = [];
	for (const item of items) {
		const tml = coerceTml(item, log);
		if (tml !== null) out.push(tml);
	}
	return out;
}

class YamlSourceError extends Error {
	constructor(readonly filePath: string) {
		super(`${filePath} is not JSON`);
	}
}

/** Same order as Python's os.walk (top-down): a directory's files, then its subdirectories. */
function walk(dir: string, files: string[]): void {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const subdirs: string[] = [];
	for (const e of entries) {
		const full = path.join(dir, e.name);
		let isDir = e.isDirectory();
		if (e.isSymbolicLink()) {
			// os.walk lists a symlinked directory as a dir but doesn't descend into it.
			try {
				if (fs.statSync(full).isDirectory()) continue;
			} catch {
				// dangling link: listed as a file, like os.walk
			}
			isDir = false;
		}
		if (isDir) subdirs.push(full);
		else if (TML_EXTS.some((x) => e.name.endsWith(x)) || e.name.endsWith('.json'))
			files.push(full);
	}
	for (const d of subdirs) walk(d, files);
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/** Collect {models, tables} as parsed objects from files/dirs/dumps. */
export function discover(srcPaths: string[], log?: Log): { models: Tml[]; tables: Tml[] } {
	const files: string[] = [];
	for (const p of srcPaths) {
		if (isDirectory(p)) walk(p, files);
		else files.push(p);
	}
	const models: Tml[] = [];
	const tables: Tml[] = [];
	const yamlFiles: string[] = [];
	for (const fp of files) {
		try {
			for (const tml of loadSourceFile(fp, log)) ('model' in tml ? models : tables).push(tml);
		} catch (exc) {
			if (exc instanceof YamlSourceError) yamlFiles.push(fp);
			else process.stderr.write(`Skipping unreadable source ${fp}: ${String(exc)}\n`);
		}
	}
	if (yamlFiles.length) {
		throw new BuildError(
			`Not JSON (YAML TML is not supported): ${yamlFiles.join(', ')}. ${yamlHelp}`,
		);
	}
	return { models, tables };
}

export function tableIndex(tableTmls: Tml[]): {
	byGuid: Map<unknown, Tml>;
	byName: Map<unknown, Tml>;
} {
	const byGuid = new Map<unknown, Tml>();
	const byName = new Map<unknown, Tml>();
	for (const t of tableTmls) {
		const guid = get(t, 'guid');
		const table = get(t, 'table', {});
		const name = get(isDict(table) ? table : {}, 'name');
		if (truthy(guid)) byGuid.set(guid, t);
		if (truthy(name)) byName.set(name, t);
	}
	return { byGuid, byName };
}

/**
 * Attach an agent-synthesised corpus to matching models (by guid, then name).
 *
 * aiMap: {model_guid_or_name: {ai_analysis: {domain, objectives, personas,
 * questions}, ai_instructions: [...]}}. Read-only enrichment of the ERD, never
 * written back to the source model.
 */
export function applyAiAnalysis(parsed: ErdModel[], aiMap: unknown, log: Log): void {
	const map = isDict(aiMap) ? aiMap : {};
	const lookup = (k: unknown) =>
		typeof k === 'string' && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
	for (const m of parsed) {
		const info = m.model;
		const entry = truthy(lookup(info.guid)) ? lookup(info.guid) : lookup(info.name);
		if (!truthy(entry)) continue;
		if (truthy(get(entry, 'ai_analysis'))) info.ai_analysis = get(entry, 'ai_analysis');
		if (truthy(get(entry, 'ai_instructions')))
			info.ai_instructions = get(entry, 'ai_instructions');
		log(`Applied AI-analysis corpus to model '${info.name ?? ''}'.`);
	}
}

export interface BuildOptions {
	maxModels?: number;
	redactRls?: boolean;
	aiAnalysisPath?: string | null;
	log?: Log;
}

const stdoutLog: Log = (msg) => {
	process.stdout.write(msg + '\n');
};

export function build(srcPaths: string[], outPath: string, opts: BuildOptions = {}): string {
	const { maxModels = 25, redactRls = false, aiAnalysisPath = null, log = stdoutLog } = opts;
	const { models: modelTmls, tables: tableTmls } = discover(srcPaths, log);
	if (!modelTmls.length) {
		throw new BuildError(
			'No Model TML found in the given source(s). Expected an export metadata TML JSON ' +
				'dump (exported with associated objects) or JSON TML file(s) containing a ' +
				`\`model\` block. Found ${tableTmls.length} table TML(s) but 0 models — nothing to diagram.`,
		);
	}
	const { byGuid, byName } = tableIndex(tableTmls);
	const parsed: ErdModel[] = [];
	for (const mtml of modelTmls) {
		const needed = new Map<unknown, Tml>();
		const model = get(mtml, 'model', {});
		const mts = get(isDict(model) ? model : {}, 'model_tables', []);
		for (const mt of Array.isArray(mts) ? mts.filter(isDict) : []) {
			const t = byGuid.get(get(mt, 'fqn')) ?? byName.get(get(mt, 'name'));
			if (t) needed.set(get(mt, 'name'), t);
		}
		parsed.push(parseModel(mtml, needed, log));
	}
	if (aiAnalysisPath) {
		applyAiAnalysis(parsed, JSON.parse(fs.readFileSync(aiAnalysisPath, 'utf8')), log);
	}
	const bundle = assemble(parsed, { maxModels, redactRls, log });
	return writeHtml(bundle, outPath);
}

// --- CLI wrapper (argparse equivalent) ---

const USAGE =
	'usage: build_erd.ts [-h] [--out OUT] [--max-models MAX_MODELS] [--redact-rls]\n' +
	'                    [--ai-analysis AI_ANALYSIS] src [src ...]';

export interface CliArgs {
	src: string[];
	out: string;
	maxModels: number;
	redactRls: boolean;
	aiAnalysis: string | null;
}

export function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		src: [],
		out: 'model_erd.html',
		maxModels: 25,
		redactRls: false,
		aiAnalysis: null,
	};
	const fail = (msg: string): never => {
		throw new UsageError(`${USAGE}\nbuild_erd.ts: error: ${msg}`);
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '-h' || a === '--help') throw new UsageError(USAGE, 0);
		if (!a.startsWith('--')) {
			args.src.push(a);
			continue;
		}
		const [flag, inline] = a.includes('=')
			? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
			: [a, undefined];
		const value = (): string => {
			if (inline !== undefined) return inline;
			const v = argv[++i];
			if (v === undefined) fail(`argument ${flag}: expected one argument`);
			return v;
		};
		if (flag === '--out') args.out = value();
		else if (flag === '--ai-analysis') args.aiAnalysis = value();
		else if (flag === '--redact-rls') args.redactRls = true;
		else if (flag === '--max-models') {
			const v = value();
			if (!/^\s*[-+]?\d+\s*$/.test(v))
				fail(`argument --max-models: invalid int value: '${v}'`);
			args.maxModels = parseInt(v, 10);
		} else fail(`unrecognized arguments: ${a}`);
	}
	if (!args.src.length) fail('the following arguments are required: src');
	return args;
}

class UsageError extends Error {
	constructor(
		message: string,
		readonly code = 2,
	) {
		super(message);
	}
}

export function main(argv: string[]): number {
	try {
		const args = parseArgs(argv);
		const out = build(args.src, args.out, {
			maxModels: args.maxModels,
			redactRls: args.redactRls,
			aiAnalysisPath: args.aiAnalysis,
		});
		process.stdout.write(`Wrote ${out}\n`);
		return 0;
	} catch (err) {
		if (err instanceof UsageError) {
			(err.code === 0 ? process.stdout : process.stderr).write(err.message + '\n');
			return err.code;
		}
		process.stderr.write((err instanceof BuildError ? err.message : String(err)) + '\n');
		return 1;
	}
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
	process.exit(main(process.argv.slice(2)));
}
