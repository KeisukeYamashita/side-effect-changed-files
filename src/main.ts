import * as fs from "node:fs/promises";
import * as core from "@actions/core";
import YAML from "yaml";
import type { Config } from "./config";
import { generateTerraformMapping } from "./generators/terraform";
import { map } from "./map";
import * as util from "./util";

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
	try {
		const autoInput = core.getInput("auto", { required: false });
		const auto = autoInput ? assertAuto(autoInput) : undefined;

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
			mapping_file: core.getInput("mapping_file", { required: false }),
			merge: core.getInput("merge", { required: true }) === "true",
			auto,
		};

		core.debug(`Input changes: ${JSON.stringify(config.files)}`);

		if (config.auto === "terraform") {
			core.debug("Generating terraform mapping...");
			const generated = await generateTerraformMapping();
			config.mapping = {
				...config.mapping,
				...generated,
			};
		}

		if (config.mapping_file) {
			core.debug(`Reading mapping file: ${config.mapping_file}`);
			const file = await readMappingFile(config.mapping_file, config.auto);
			if (file !== undefined) {
				config.mapping = {
					...config.mapping,
					...YAML.parse(file),
				};
			}
		}

		if (!config.mapping || Object.keys(config.mapping).length === 0) {
			core.setFailed(
				"No mapping resolved. Provide `mapping`, `mapping_file`, or `auto`.",
			);
			return;
		}

		core.debug(`Mapping: ${JSON.stringify(config.mapping)}`);
		await map("files", config.files, config.mapping, {
			...config,
		});
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message);
	}
}

function assertAuto(input: string): Config["auto"] {
	if (input === "terraform") return "terraform";
	throw new Error(`Unsupported \`auto\` value: ${input}. Supported: terraform`);
}

/**
 * Read the mapping file. When `auto` is set the default `.github/side-effect.yml`
 * may legitimately not exist (the mapping is generated), so a missing file is
 * not an error in that case.
 */
async function readMappingFile(
	mappingFile: string,
	auto: Config["auto"],
): Promise<string | undefined> {
	try {
		return await fs.readFile(mappingFile, "utf-8");
	} catch (err) {
		if (auto && isMissingFile(err)) {
			core.debug(
				`Mapping file ${mappingFile} not found; relying on auto=${auto}.`,
			);
			return undefined;
		}
		throw err;
	}
}

function isMissingFile(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code: string }).code === "ENOENT"
	);
}
