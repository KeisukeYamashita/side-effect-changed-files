import * as core from "@actions/core";
import fg from "fast-glob";
import micromatch from "micromatch";
import type { Kind } from "./util";
import * as util from "./util";
import * as path from "node:path";

export type MapArgs = {
	/**
	 * Output unique changed directories instead of filenames.
	 */
	dirNames?: boolean;

	/**
	 * Escape JSON special characters.
	 */
	escape_json?: boolean;

	/**
	 * Filter glob patterns.
	 */
	filter?: string[];

	/**
	 * Include the target glob pattern to match the inputs.
	 */
	include?: boolean;

	/**
	 * Merge the output of the mapping with the existing inputs.
	 *
	 * @default true
	 */
	merge?: boolean;

	/**
	 * Output in JSON format.
	 *
	 * @default false
	 */
	json?: boolean;
};

/**
 * Map processes the mapping and the input and output of the data.
 */
export async function map(
	kind: Kind,
	targets: string[],
	mapping: Record<string, string[]>,
	args?: MapArgs,
): Promise<string[]> {
	let results: string[] = [];

	core.startGroup(`Mapping files for ${kind}...`);
	core.debug(`Arguments: ${JSON.stringify(args)}`);

	for (const [key, globs] of Object.entries(mapping)) {
		core.startGroup(`For ${key} with condition ${JSON.stringify(globs)}`);

		const gs = globs;
		if (args?.include) {
			core.debug(`Include ${key} to match the inputs.`);
			gs.push(key);
		}

		const files = micromatch(targets, globs);
		core.debug(`Micromatch-ed: ${JSON.stringify(files)}`);

		if (files.length) {
			let result = await fg.glob(key);

			core.debug(`Globbed: ${JSON.stringify(result)}`);
			if (args?.dirNames) {
				result = result.map((f) => path.dirname(f));
				result = Array.from(new Set(result)); // Remove duplications
			}

			core.info(`Found ${JSON.stringify(result)}`);
			results.push(...result);
		}

		core.endGroup();
	}

	if (args?.merge) {
		core.debug("Merging with existing inputs...");
		results.push(...targets);
	}

	if (args?.filter?.length) {
		core.debug(
			`Filtering results ${JSON.stringify(results)} with filter ${JSON.stringify(args.filter)}`,
		);
		results = micromatch(results, args.filter);
		core.debug(`Filtered: ${JSON.stringify(results)}`);
	}

	core.info(`Result: ${JSON.stringify(results)}`);

	util.setOutput(kind, results, {
		count: true,
		json: args?.json,
		escape_json: args?.escape_json,
	});

	core.endGroup();

	return results;
}
