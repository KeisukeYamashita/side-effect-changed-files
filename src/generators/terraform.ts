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
				const moduleAbs = path.resolve(path.dirname(abs), source);
				const moduleRel = path.relative(workingDir, moduleAbs);

				// Skip module sources that resolve outside of the working directory.
				if (moduleRel === "" || moduleRel.startsWith("..")) continue;

				const moduleGlob = toTfGlob(moduleRel);

				// A module entry that points at itself is a no-op.
				if (moduleGlob === consumerGlob) continue;

				addEdge(mapping, consumerGlob, moduleGlob);
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
