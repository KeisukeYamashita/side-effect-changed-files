import * as core from "@actions/core";
import YAML from "yaml";
import type { Config } from "./config";
import { map } from "./map";

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
	try {
		const config: Config = {
			bypass: core.getMultilineInput("bypass", { required: false }),
			dirNames: core.getInput("dir_names", { required: true }) === "true",
			escape_json: core.getInput("escape_json", { required: true }) === "true",
			files: core.getInput("files", { required: false }).split(" "),
			filters: core.getMultilineInput("filters", { required: false }),
			include: core.getInput("include", { required: false }) === "true",
			json:
				core.getInput("json", { required: true }) === "true" ||
				core.getInput("matrix", { required: true }) === "true",
			mapping: YAML.parse(core.getInput("mapping", { required: true })),
			merge: core.getInput("merge", { required: true }) === "true",
		};

		core.debug(`Input changes: ${JSON.stringify(config.files)}`);
		const results = await map("files", config.files, config.mapping, {
			...config,
		});
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message);
	}
}
