import * as core from "@actions/core";
import YAML from "yaml";
import type { Config } from "./config";
import { map } from "./map";
import * as util from "./util";
import * as fs from "node:fs/promises";

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
	try {
		const config: Config = {
			bypass: util.getMultilineInput("bypass", { required: false }),
			dirNames: core.getInput("dir_names", { required: true }) === "true",
			dirNamesMaxDepth: Number.parseInt(
				core.getInput("dir_names_max_depth", { required: false }) || "0",
				10,
			),
			escape_json: core.getInput("escape_json", { required: true }) === "true",
			files: util.getMultilineInput("files", { required: false }),
			filters: util.getMultilineInput("filters", { required: false }),
			include: core.getInput("include", { required: false }) === "true",
			json:
				core.getInput("json", { required: true }) === "true" ||
				core.getInput("matrix", { required: true }) === "true",
			mapping: YAML.parse(core.getInput("mapping", { required: false })),
			mapping_file: core.getInput("mapping_file", { required: true }),
			merge: core.getInput("merge", { required: true }) === "true",
		};

		core.debug(`Input changes: ${JSON.stringify(config.files)}`);

		if (config.mapping_file) {
			core.debug(`Reading mapping file: ${config.mapping_file}`);
			const file = await fs.readFile(config.mapping_file, "utf-8");
			config.mapping = {
				...config.mapping,
				...YAML.parse(file),
			};
		}

		if (!config.mapping) {
			core.setFailed("Either `mapping` or `mapping_file` is required.");
		}

		core.debug(`Mapping: ${JSON.stringify(config.mapping)}`);
		const results = await map("files", config.files, config.mapping, {
			...config,
		});
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message);
	}
}
