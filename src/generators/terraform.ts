import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as core from "@actions/core";
import fg from "fast-glob";

export type GenerateTerraformMappingArgs = {
	/**
	 * Directory to scan for `.tf` files. Defaults to the current working directory.
	 */
	workingDir?: string;

	/**
	 * Glob patterns of `.tf` files to exclude from the scan.
	 */
	ignore?: string[];

	/**
	 * Identity of the repository being scanned, used to detect self-referencing
	 * git module sources without a `?ref=` pin. When omitted, the identity is
	 * read from the GitHub Actions environment (`GITHUB_REPOSITORY` and
	 * `GITHUB_SERVER_URL`).
	 *
	 * When unavailable, self-reference detection is skipped and such sources
	 * fall back to the regular remote-source grouping behavior.
	 */
	selfRepo?: SelfRepo;
};

/**
 * Repository identity used for self-reference detection.
 *
 * `host` is the bare hostname (e.g. `github.com`, `ghe.example.com`) and
 * `slug` is `<owner>/<repo>` without the `.git` suffix.
 */
export type SelfRepo = {
	host: string;
	slug: string;
};

const DEFAULT_IGNORE = ["**/.terraform/**", "**/node_modules/**"];

/**
 * Generates a mapping for terraform module usage.
 *
 * For every `module "..." { source = "..." }` block whose source is a local
 * path, an entry is added so that when any file under the referenced module
 * directory changes the consumer's tf files are output.
 *
 * The produced mapping is shaped as:
 *
 *   {
 *     "<consumer-dir>/**\/*.tf": ["<module-dir>/**\/*.tf", ...]
 *   }
 *
 * Non-local module sources (registry, git, http, ...) and sources resolving
 * outside `workingDir` are skipped.
 */
export async function generateTerraformMapping(
	args?: GenerateTerraformMappingArgs,
): Promise<Record<string, string[]>> {
	const workingDir = path.resolve(args?.workingDir ?? process.cwd());
	const ignore = [...DEFAULT_IGNORE, ...(args?.ignore ?? [])];
	const selfRepo = args?.selfRepo ?? readSelfRepoFromEnv();
	if (selfRepo) {
		core.debug(
			`Terraform generator: self-ref host=${selfRepo.host} slug=${selfRepo.slug}`,
		);
	}

	const tfFiles = await fg.glob("**/*.tf", {
		cwd: workingDir,
		ignore,
		onlyFiles: true,
		dot: false,
	});

	core.debug(`Terraform generator: scanning ${tfFiles.length} .tf files`);

	const mapping: Record<string, Set<string>> = {};

	// Remote sources cannot be globbed against repository files, so we group
	// consumers that share the same exact remote source string. Each group
	// becomes an equivalence class: changing one consumer in the group triggers
	// the others. The source string is the identity, so different `?ref=`
	// values are intentionally not grouped together.
	const remoteGroups: Record<string, Set<string>> = {};

	for (const rel of tfFiles) {
		const abs = path.join(workingDir, rel);
		let content: string;
		try {
			content = await fs.readFile(abs, "utf-8");
		} catch (err) {
			core.warning(`Failed to read ${rel}: ${(err as Error).message}`);
			continue;
		}

		const sources = extractModuleSources(content);
		if (sources.length === 0) continue;

		const consumerDir = path.dirname(rel);
		const consumerGlob = toTfGlob(consumerDir);

		for (const source of sources) {
			if (isLocalSource(source)) {
				const moduleRel = resolveLocalSubpath(workingDir, abs, source);
				if (moduleRel === undefined) continue;
				addLocalEdge(mapping, consumerGlob, moduleRel);
				continue;
			}

			// A self-referencing git source without `?ref=` resolves to the default
			// branch of the same repo, which (in CI's "if this merged" semantics)
			// effectively reads the working-tree subpath. Treat it like a local
			// source pointing at that subpath.
			const selfSubpath = selfRepo
				? matchSelfReferenceSubpath(source, selfRepo)
				: undefined;
			if (selfSubpath !== undefined) {
				const moduleAbs = path.resolve(workingDir, selfSubpath);
				const moduleRel = path.relative(workingDir, moduleAbs);
				if (moduleRel === "" || moduleRel.startsWith("..")) continue;
				addLocalEdge(mapping, consumerGlob, moduleRel);
				continue;
			}

			if (!remoteGroups[source]) remoteGroups[source] = new Set();
			remoteGroups[source].add(consumerGlob);
		}
	}

	for (const [source, members] of Object.entries(remoteGroups)) {
		if (members.size < 2) continue;
		core.debug(
			`Terraform generator: ${members.size} consumers share remote source ${source}`,
		);
		const all = Array.from(members);
		for (const self of all) {
			for (const other of all) {
				if (other === self) continue;
				addEdge(mapping, self, other);
			}
		}
	}

	const result: Record<string, string[]> = {};
	for (const [key, set] of Object.entries(mapping)) {
		result[key] = Array.from(set).sort();
	}
	return result;
}

function addEdge(
	mapping: Record<string, Set<string>>,
	key: string,
	value: string,
): void {
	if (!mapping[key]) mapping[key] = new Set();
	mapping[key].add(value);
}

/**
 * Add a `consumer-glob <- module-dir-glob` edge, deduplicating self-loops.
 */
function addLocalEdge(
	mapping: Record<string, Set<string>>,
	consumerGlob: string,
	moduleRel: string,
): void {
	const moduleGlob = toTfGlob(moduleRel);
	if (moduleGlob === consumerGlob) return;
	addEdge(mapping, consumerGlob, moduleGlob);
}

/**
 * Resolve a `./...` / `../...` source relative to its consumer file and return
 * the path relative to the working directory, or `undefined` if it resolves
 * outside the working dir.
 */
function resolveLocalSubpath(
	workingDir: string,
	consumerAbs: string,
	source: string,
): string | undefined {
	const moduleAbs = path.resolve(path.dirname(consumerAbs), source);
	const moduleRel = path.relative(workingDir, moduleAbs);
	if (moduleRel === "" || moduleRel.startsWith("..")) return undefined;
	return moduleRel;
}

/**
 * Read the self-repository identity from the GitHub Actions environment.
 * Supports GHE: the hostname comes from `GITHUB_SERVER_URL`, falling back to
 * `github.com` only when the URL is missing or unparsable. Returns `undefined`
 * when `GITHUB_REPOSITORY` is unset so the caller can skip self-ref detection.
 */
function readSelfRepoFromEnv(): SelfRepo | undefined {
	const slug = process.env.GITHUB_REPOSITORY?.trim();
	if (!slug || !slug.includes("/")) return undefined;
	const host = parseServerHost(process.env.GITHUB_SERVER_URL);
	if (!host) return undefined;
	return { host, slug: slug.replace(/\.git$/, "") };
}

function parseServerHost(raw: string | undefined): string | undefined {
	const trimmed = raw?.trim();
	if (!trimmed) return "github.com";
	try {
		const u = new URL(trimmed);
		return u.host || undefined;
	} catch {
		return undefined;
	}
}

/**
 * If `source` is a self-referencing terraform module address with no `?ref=`
 * pin, return the in-repo subpath it points at (`""` for the repo root,
 * `"modules/foo"` for a submodule, etc.). Returns `undefined` otherwise.
 *
 * Supported forms (where `<host>` matches `selfRepo.host` and `<slug>` matches
 * `selfRepo.slug`, optionally with a `.git` suffix):
 *   - `<host>/<slug>`                       (HTTPS shorthand)
 *   - `<host>/<slug>//<subpath>`
 *   - `git::https://<host>/<slug>(.git)`
 *   - `git::https://<host>/<slug>(.git)//<subpath>`
 *   - `git::ssh://git@<host>/<slug>(.git)(//<subpath>)`
 *   - `git@<host>:<slug>(.git)(//<subpath>)` (scp-like SSH)
 *
 * A `?ref=...` query parameter disqualifies the match: those sources are
 * pinned to a specific revision and intentionally fall back to remote-source
 * grouping.
 */
export function matchSelfReferenceSubpath(
	source: string,
	selfRepo: SelfRepo,
): string | undefined {
	// Reject anything with an explicit ref.
	if (/\?(?:[^#]*&)?ref=/.test(source)) return undefined;
	// Strip any query string (no ref present anyway) and fragment.
	const cleaned = source.split("?")[0].split("#")[0];

	const candidate = parseGitAddress(cleaned);
	if (!candidate) return undefined;
	if (candidate.host !== selfRepo.host) return undefined;
	if (candidate.slug !== selfRepo.slug) return undefined;
	return candidate.subpath;
}

type GitAddress = { host: string; slug: string; subpath: string };

function parseGitAddress(raw: string): GitAddress | undefined {
	// Detached terraform-style getter prefix (e.g. `git::https://...`).
	const detached = raw.match(/^[a-z0-9]+::(.+)$/i);
	const body = detached ? detached[1] : raw;

	// scp-like SSH: git@host:owner/repo(//subpath)
	const scp = body.match(/^[^@\s]+@([^:]+):([^/]+\/[^/?#]+)(?:\/\/(.*))?$/);
	if (scp) {
		return finalize(scp[1], scp[2], scp[3]);
	}

	// URL forms: scheme://[user@]host/owner/repo(//subpath)
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(body)) {
		try {
			const u = new URL(body);
			const [, slug, subpathFromUrl] = matchUrlPath(u.pathname) ?? [];
			if (!slug) return undefined;
			return finalize(u.host, slug, subpathFromUrl);
		} catch {
			return undefined;
		}
	}

	// Bare form: host/owner/repo(//subpath)
	const bare = body.match(/^([^/?#]+)\/([^/]+\/[^/?#]+)(?:\/\/(.*))?$/);
	if (bare) {
		return finalize(bare[1], bare[2], bare[3]);
	}
	return undefined;
}

function matchUrlPath(
	pathname: string,
): [full: string, slug: string, subpath: string | undefined] | undefined {
	const m = pathname.match(/^\/([^/]+\/[^/]+?)(?:\/\/(.*))?\/?$/);
	if (!m) return undefined;
	return [m[0], m[1], m[2]];
}

function finalize(
	host: string,
	rawSlug: string,
	rawSubpath: string | undefined,
): GitAddress {
	const slug = rawSlug.replace(/\.git$/, "");
	const subpath = (rawSubpath ?? "").replace(/\/$/, "");
	return { host, slug, subpath };
}

/**
 * Convert a directory (relative to the working dir) into a `**\/*.tf` glob.
 * The current directory is represented as `"."`.
 */
function toTfGlob(dir: string): string {
	const normalized = dir.split(path.sep).join("/");
	if (normalized === "" || normalized === ".") return "**/*.tf";
	return `${normalized}/**/*.tf`;
}

function isLocalSource(source: string): boolean {
	return source.startsWith("./") || source.startsWith("../");
}

/**
 * Extract the `source` values from every `module "..." { ... }` block in the
 * given HCL content. Brace-aware so blocks containing nested blocks (e.g.
 * `providers { ... }`) are handled correctly.
 */
export function extractModuleSources(content: string): string[] {
	const cleaned = stripComments(content);
	const sources: string[] = [];
	const moduleStart = /\bmodule\s+"[^"]+"\s*\{/g;

	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic global regex iteration
	while ((match = moduleStart.exec(cleaned)) !== null) {
		const openIdx = match.index + match[0].length - 1; // index of `{`
		const closeIdx = findMatchingBrace(cleaned, openIdx);
		if (closeIdx === -1) continue;

		const block = cleaned.slice(openIdx + 1, closeIdx);
		const source = extractTopLevelSource(block);
		if (source !== undefined) sources.push(source);

		// Continue scanning after the block to avoid matching `module` keywords
		// nested inside another module's body (which would be invalid anyway).
		moduleStart.lastIndex = closeIdx + 1;
	}
	return sources;
}

/**
 * Returns the index of the `}` that matches the `{` at `openIdx`, or -1 if
 * the braces are unbalanced. Strings are skipped so braces inside HCL string
 * literals are not counted.
 */
function findMatchingBrace(s: string, openIdx: number): number {
	let depth = 0;
	let inString = false;
	for (let i = openIdx; i < s.length; i++) {
		const ch = s[i];
		if (inString) {
			if (ch === "\\") {
				i++;
				continue;
			}
			if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Look for `source = "..."` only at the top level of a module block (depth 0),
 * so that an inner block like `providers { source = ... }` doesn't fool us.
 */
function extractTopLevelSource(block: string): string | undefined {
	let depth = 0;
	let inString = false;
	for (let i = 0; i < block.length; i++) {
		const ch = block[i];
		if (inString) {
			if (ch === "\\") {
				i++;
				continue;
			}
			if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") {
			depth++;
			continue;
		}
		if (ch === "}") {
			depth--;
			continue;
		}
		if (depth !== 0) continue;

		if (
			block.startsWith("source", i) &&
			/\s/.test(block[i - 1] ?? "\n") // word boundary on the left
		) {
			const rest = block.slice(i + "source".length);
			const m = /^\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(rest);
			if (m) return m[1];
		}
	}
	return undefined;
}

/**
 * Strip HCL comments (`#`, `//` line comments and slash-star block comments).
 * Strings are preserved.
 */
export function stripComments(s: string): string {
	let out = "";
	let i = 0;
	let inString = false;
	while (i < s.length) {
		const ch = s[i];
		if (inString) {
			out += ch;
			if (ch === "\\" && i + 1 < s.length) {
				out += s[i + 1];
				i += 2;
				continue;
			}
			if (ch === '"') inString = false;
			i++;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			i++;
			continue;
		}
		if (ch === "/" && s[i + 1] === "*") {
			const end = s.indexOf("*/", i + 2);
			i = end === -1 ? s.length : end + 2;
			continue;
		}
		if (ch === "/" && s[i + 1] === "/") {
			const nl = s.indexOf("\n", i + 2);
			i = nl === -1 ? s.length : nl;
			continue;
		}
		if (ch === "#") {
			const nl = s.indexOf("\n", i + 1);
			i = nl === -1 ? s.length : nl;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}
