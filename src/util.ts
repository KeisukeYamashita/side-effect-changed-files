import * as core from "@actions/core";
export type Kind = "files";

export type SetOutputOptions = {
	count: boolean;
	escape_json?: boolean;
	json?: boolean;
};

export function setOutput(
	kind: Kind,
	value: string[],
	opts?: SetOutputOptions,
) {
	/**
	 * Inspired by tf-actions/changed-files
	 *
	 * @see {@link https://github.com/tj-actions/changed-files/blob/f79274f27befa7e1bf6d5eb1c4964c0f65cea226/src/utils.ts#L1402}
	 */
	if (opts?.json) {
		let json = JSON.stringify(value);
		json = opts.escape_json ? json.replace(/"/g, '\\"') : json;

		// Inspired by tf-actions/changed-files
		// Ref: https://github.com/tj-actions/changed-files/blob/f79274f27befa7e1bf6d5eb1c4964c0f65cea226/src/utils.ts#L1407
		json = json.replace(/[^\x20-\x7E]|[:*?<>|;`$()&!]/g, "\\$&");
		core.setOutput(kind, json);
	} else {
		core.setOutput(kind, value.toString().trim());
	}

	if (opts?.count) {
		core.setOutput(`${kind}_count`, value.length);
	}

	core.setOutput("changed", value.length > 0);
}
