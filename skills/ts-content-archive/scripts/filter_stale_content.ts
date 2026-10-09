#!/usr/bin/env -S npx tsx
/**
 * Filter ThoughtSpot metadata objects down to the stale-content candidate set.
 *
 * Pure data transform, no network calls, no mutation. The skill fetches
 * activity GUIDs and metadata rows via the REST API in earlier steps, then
 * needs this exact filtering logic applied in one pass over the result set.
 *
 * This file has two parts:
 *
 *   1. `filterStaleContent()` (below) — the actual logic. Zero Node.js APIs,
 *      zero I/O, takes a plain object and returns a plain object. This is the
 *      part that must run identically everywhere, regardless of execution
 *      environment.
 *   2. A CLI wrapper at the bottom (stdin -> filterStaleContent() -> stdout)
 *      for local `npx tsx` runs. It uses `process`, which is NOT available in
 *      every environment — see below.
 *
 * Two ways to run this, per SKILL.md Step 5:
 *
 *   A. Local shell + filesystem access:
 *        npx tsx filter_stale_content.ts < input.json
 *
 *   B. A sandboxed code-exec tool with no local filesystem or `process` (e.g.
 *      this repo's own execute-thoughtspot-code — see
 *      src/mcp/code-exec/engines/worker-loader/module-source.ts: the sandbox
 *      is a Cloudflare Workers isolate, and the tool's `code` parameter is
 *      spliced into `async () => { ${code} }` — no `process`, no stdin, no
 *      module system, just a function body that must `return` its result).
 *      For this path: copy ONLY `filterStaleContent`, its `isStale` helper and
 *      the constants above them (and its types, inlined as plain objects if
 *      the target has no TS support) into
 *      the `code` string, call it with the in-scope data, and `return` its
 *      result. Do not include the CLI wrapper below — `process` doesn't
 *      exist there and would throw.
 *
 * Input shape (same for both paths):
 * {
 *   "todayEpochMs": 1234567890000,
 *   "activeGuids": ["guid1", "guid2", ...],
 *   "metadata": [
 *     {
 *       "guid": "...", "name": "...", "type": "ANSWER",
 *       "authorGuid": "...", "authorName": "...",
 *       "tags": [{"id": "...", "name": "..."}],
 *       "modifiedEpochMs": 1234567890000
 *     }, ...
 *   ],
 *   "recentModifiedDays": 100,
 *   "systemAuthorGuids": ["tsadmin-guid", "system-guid", "su-guid"],
 *   "ignoreTags": null,
 *   "onlyAuthorGuids": null,
 *   "ignoreAuthorGuids": null,
 *   "onlyGroupAuthorGuids": null,
 *   "ignoreGroupAuthorGuids": null
 * }
 *
 * `onlyAuthorGuids`/`ignoreAuthorGuids` restrict/exclude by INDIVIDUAL author
 * GUID (e.g. "just Aditya's content") — distinct from
 * `onlyGroupAuthorGuids`/`ignoreGroupAuthorGuids`, which restrict/exclude by
 * GROUP membership (resolved to a set of member GUIDs before calling this).
 * Both pairs may be supplied at once; all supplied conditions must hold.
 *
 * System accounts (`SYSTEM_ACCOUNT_NAMES`: tsadmin, system, su) are always
 * excluded: by `systemAuthorGuids`, and by exact case-insensitive `authorName`.
 *
 * Output shape (same for both paths):
 * { "filtered": [ ...same shape as input metadata rows, plus "daysInactive"... ], "count": <number> }
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The fixed list of ThoughtSpot built-in accounts whose content is never a
 * candidate: the three cs_tools reads from session info (`tsadmin_user_id`,
 * `system_user_id`, `super_user_id`). cs_tools' `identify` docstring promises
 * this exclusion but never applies it; this skill applies it intentionally.
 */
export const SYSTEM_ACCOUNT_NAMES = ['tsadmin', 'system', 'su'] as const;

interface Tag {
	id: string;
	name: string;
}

interface MetadataObject {
	guid: string;
	name: string;
	type: string;
	authorGuid: string;
	authorName: string;
	tags: Tag[];
	modifiedEpochMs: number;
}

interface FilterInput {
	todayEpochMs: number;
	activeGuids: string[];
	metadata: MetadataObject[];
	recentModifiedDays: number;
	systemAuthorGuids: string[];
	/** Tag names (case-sensitive). Content carrying ANY of them is kept out. cs_tools `--ignore-tags`. */
	ignoreTags?: string[] | null;
	/** Deprecated single-tag form of `ignoreTags`, still accepted. */
	ignoreTag?: string | null;
	onlyAuthorGuids: string[] | null;
	ignoreAuthorGuids: string[] | null;
	onlyGroupAuthorGuids: string[] | null;
	ignoreGroupAuthorGuids: string[] | null;
}

interface FilterOutput {
	filtered: (MetadataObject & { daysInactive: number })[];
	count: number;
	/**
	 * Proof-of-execution marker — present ONLY because this function actually
	 * ran, not because an agent wrote equivalent logic by hand. If asked to
	 * confirm the real script ran (vs. improvised inline logic), report this
	 * field's exact value back verbatim — it cannot appear by coincidence.
	 */
	_ranVia: 'filter_stale_content.ts:filterStaleContent';
}

function isStale(
	obj: MetadataObject,
	opts: {
		todayMs: number;
		activeGuids: Set<string>;
		recentModifiedDays: number;
		systemAuthorGuids: Set<string>;
		ignoreTags: Set<string> | null;
		onlyAuthors: Set<string> | null;
		ignoreAuthors: Set<string> | null;
		onlyGroupAuthors: Set<string> | null;
		ignoreGroupAuthors: Set<string> | null;
	},
): boolean {
	// ALL conditions must hold; any single failure disqualifies the object.
	if (opts.activeGuids.has(obj.guid)) return false;

	const daysSinceModified = (opts.todayMs - obj.modifiedEpochMs) / MS_PER_DAY;
	if (daysSinceModified < opts.recentModifiedDays) return false;

	// System accounts: by resolved GUID, and by exact (case-insensitive) author
	// name as a backstop for an id the caller couldn't resolve.
	if (opts.systemAuthorGuids.has(obj.authorGuid)) return false;
	if (
		typeof obj.authorName === 'string' &&
		(SYSTEM_ACCOUNT_NAMES as readonly string[]).includes(obj.authorName.toLowerCase())
	) {
		return false;
	}

	if (opts.onlyAuthors !== null && !opts.onlyAuthors.has(obj.authorGuid)) return false;

	if (opts.ignoreAuthors !== null && opts.ignoreAuthors.has(obj.authorGuid)) return false;

	if (opts.onlyGroupAuthors !== null && !opts.onlyGroupAuthors.has(obj.authorGuid)) return false;

	if (opts.ignoreGroupAuthors !== null && opts.ignoreGroupAuthors.has(obj.authorGuid))
		return false;

	if (opts.ignoreTags !== null && obj.tags.some((t) => opts.ignoreTags!.has(t.name))) {
		return false;
	}

	return true;
}

/**
 * The part that must run identically in every environment. No Node.js APIs,
 * no I/O — a plain function from one JSON-shaped object to another. This is
 * what a sandboxed code-exec tool's `code` parameter should contain (plus a
 * call to it and a `return`), copied verbatim rather than reimplemented.
 */
export function filterStaleContent(payload: FilterInput): FilterOutput {
	const activeGuids = new Set(payload.activeGuids ?? []);
	const ignoreTagList = [
		...(payload.ignoreTags ?? []),
		...(payload.ignoreTag ? [payload.ignoreTag] : []),
	];
	const ignoreTags = ignoreTagList.length > 0 ? new Set(ignoreTagList) : null;
	const systemAuthorGuids = new Set(payload.systemAuthorGuids ?? []);
	const onlyAuthors =
		payload.onlyAuthorGuids !== null && payload.onlyAuthorGuids !== undefined
			? new Set(payload.onlyAuthorGuids)
			: null;
	const ignoreAuthors =
		payload.ignoreAuthorGuids !== null && payload.ignoreAuthorGuids !== undefined
			? new Set(payload.ignoreAuthorGuids)
			: null;
	const onlyGroupAuthors =
		payload.onlyGroupAuthorGuids !== null && payload.onlyGroupAuthorGuids !== undefined
			? new Set(payload.onlyGroupAuthorGuids)
			: null;
	const ignoreGroupAuthors =
		payload.ignoreGroupAuthorGuids !== null && payload.ignoreGroupAuthorGuids !== undefined
			? new Set(payload.ignoreGroupAuthorGuids)
			: null;

	const filtered = payload.metadata
		.filter((obj) =>
			isStale(obj, {
				todayMs: payload.todayEpochMs,
				activeGuids,
				recentModifiedDays: payload.recentModifiedDays,
				systemAuthorGuids,
				ignoreTags,
				onlyAuthors,
				ignoreAuthors,
				onlyGroupAuthors,
				ignoreGroupAuthors,
			}),
		)
		.map((obj) => ({
			...obj,
			daysInactive: Math.floor((payload.todayEpochMs - obj.modifiedEpochMs) / MS_PER_DAY),
		}))
		// Newest-modified first, as cs_tools previews them and SKILL.md Step 6 shows them.
		.sort((a, b) => b.modifiedEpochMs - a.modifiedEpochMs);

	return {
		filtered,
		count: filtered.length,
		_ranVia: 'filter_stale_content.ts:filterStaleContent',
	};
}

// --- CLI wrapper (local `npx tsx` runs only — uses `process`, not available
// in a sandboxed code-exec tool; see the file header) ---

function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => (data += chunk));
		process.stdin.on('end', () => resolve(data));
		process.stdin.on('error', reject);
	});
}

async function main(): Promise<void> {
	const raw = await readStdin();
	const payload: FilterInput = JSON.parse(raw);
	const output = filterStaleContent(payload);
	process.stdout.write(JSON.stringify(output, null, 2));
}

// `require`/`module`/`process` don't exist in every environment this file
// may be loaded into (e.g. a sandboxed code-exec tool's isolate) — check for
// their existence before touching them, so loading this file there is a
// silent no-op for the CLI path rather than a crash.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
	main().catch((err) => {
		process.stderr.write(String(err) + '\n');
		process.exit(1);
	});
}
