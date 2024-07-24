export type Config = {
	/**
	 * Output unique changed directories instead of filenames.
	 */
	dirNames: boolean;

	/**
	 * Escape JSON special characters.
	 */
	escape_json: boolean;

	/**
	 * Input to this action.
	 *
	 * In most cases, this will be the output of `tf-actions/changed-files` and it will be
	 * trigger a side effect in the `map` function.
	 */
	files: string[];

	/**
	 * Filter glob patterns.
	 */
	filter?: string[];

	/**
	 * YAML configuration for the mapping.
	 *
	 * It describes which files should be mapped to which output.
	 */
	mapping: Record<string, string[]>;

	/**
	 * Merge the output of the mapping with the existing outputs.
	 *
	 * If set to `true`, the output of this action will be merged with the existing outputs (files).
	 */
	merge: boolean;

	/**
	 * Output with JSON format.
	 */
	json: boolean;
};
