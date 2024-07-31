# Side effect changed files

[![GitHub Super-Linter](https://github.com/KeisukeYamashita/side-effect-changed-files/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/KeisukeYamashita/side-effect-changed-files/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/KeisukeYamashita/side-effect-changed-files/actions/workflows/check-dist.yml/badge.svg)](https://github.com/KeisukeYamashita/side-effect-changed-files/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/KeisukeYamashita/side-effect-changed-files/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/KeisukeYamashita/side-effect-changed-files/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

> GitHub Actions to trigger side effect based on changed files.

This actions is designed to work with [tj-actions/changed-files](https://github.com/tj-actions/changed-files) to trigger side effect based on changed files.

## Example

```yaml
name: CI

on:
  pull_request:
    branches:
      - main

jobs:
  files:
    runs-on: ubuntu-latest
    permissions:
      content: read

    steps:
      - uses: actions/checkout@v4

      - uses: tj-actions/changed-files@v44
        id: raw-changed-files
        files:
          - '**/*.tf'

      - name: Get changed files
        id: changed-files
        uses: KeisukeYamashita/side-effect-changed-files@v1
        with: 
          files: ${{ steps.raw-changed-files.outputs.files }}
          mapping: |
            terraform/aws:
              - modules/{aws,github}/*.tf
            terraform/gcp:
              - modules/github/*.tf
              - modules/google/*.{tf,yml}
              - !modules/google/ignore.tf

      - name: List all changed files markdown files
        env:
          ALL_CHANGED_FILES: ${{ steps.changed-files.outputs.files }}
        run: |
          for file in ${ALL_CHANGED_FILES}; do
            echo "$file was changed"
          done
```

### Inputs

| Name     | Description                                                                 | Required | Default | Example |
|----------|-----------------------------------------------------------------------------|----------|---------|----|
| `bypass` | Glob pattern to bypass the mapping. | No | `**/*.yml` |
| `dir_names` | Output unique changed directories instead of filenames. For example, if `terraform/modules/main.tf` matched as a result of the mapping, `terraform/module` will be output.  | No | `false` | `true` |
| `escape_json` | Escape JSON special characters. | No | `false` | `true` |
| `files` | Changed files. It can be in multiline. See the following section for details. | No | `[]` | `terraform/modules/main.tf terraform/modules/variable.tf` |
| `filters` | Filters the matched files. It can be in multiline. See the following section for details. | No | `[]` | `!terraform/modules/ignore.tf` |
| `include` | Include the mapping target to the glob pattern. | No | `false` | `true` |
| `json` | Output as JSON format. It is compatible with [tj-actions/changed-files](https://github.com/tj-actions/changed-files) outputs with `json` enabled. | No | `false` | `true` |
| `mapping` | YAML formatted mapping to match changed files. | Yes | | See the examples |
| `mapping_file` | YAML file path to match changed files. | No | `.github/side-effect.yml` | `./mapping.yml` |
| `matrix` | Output files in a format that can be used for GitHub Action's matrix strategy. It is alias of `json` with `true` and `escape_json` with `false`. It is intended to be enabled, when using the output as GitHub Actions matrix. | No | `false` | `true` |
| `merge` | Merge the matched files and the inputs (files passed by `files`). If `A` matched as a result of mapping from `B`, the output will include `A` and `B`. | No | `false` | `true` |

### Multiline Inputs

Some fields support multiline.

```yaml
...
      - uses: tj-actions/changed-files@v44
        id: rust-changes
        files:
          - '**/*.rs'

      - uses: tj-actions/changed-files@v44
        id: typescript-changes
        files:
          - '**/*.ts'

      - name: Get changed files
        id: changed-files
        uses: KeisukeYamashita/side-effect-changed-files@v1
        with: 
          files: |
            ${{ steps.rust-changes.outputs.files }}
            ${{ steps.typescript-changes.outputs.files }}
          mapping: |
            server/*.tf:
              - **/*.rs

            ui/*.tf:
              - **/*.ts
      ...
```

### Outputs

| Name     | Type | Description |
|----------|----|-------------|
| `changed` | `boolean` | Whether the files are changed based on the mapping. |
| `files`  | `string` or `JSON` (if `json` is `true`) | List of the mapped files. |
| `files_count` | `number` | Count of the mapped files. |

## Globbing

This action supports globbing pattern to match files backed by [micromatch](https://www.npmjs.com/package/micromatch):

- Wildcards (`*`, `**`):
  - Examples:
    - Match all Terraform files: `**/*.tf`
    - Match all Rust files under a specific crate: `mycrate/**/*.rs`
- Negations (`!`):
  - Examples:
    - Exclude a file under `src` directory: `src/**/*.ts`, `!src/ignore.ts`
- Brace expansions (`{}`):
  - Examples:
    - Match user ID files: `users/{1..10}.json`
    - Match user names: `users/{alice,bob}.json`
- Extglobs (`+(...)`, `*(...)`, `?(...)`, `@(...)`):
  - Examples:
    - Match backup files and it's backup files: `config+(.bak)`
    - Match backup files: `config*(.bak)`
    - Match template file and the actual file: `config.json?(.template)`
    - Match either `ts` or `js` files: `**/*.@{ts|js}`
- Regex character classes (`[]`):
  - Examples:
    - Match all TypeScript or JavaScript files: `**/*.[tj]s`
- Regex OR (`|`):
  - Examples:
    - Match all TypeScript and JavaScript files: `**/*.(ts|js)`

> [!TIP]
> Note that you can combine these patterns to match files.
>
> For example, `terraform/backup/202{2..4}/*{.tf,yml}` will match all Terraform files with `.tf` or `.yml` extension in `terraform/backup/2022`, `terraform/backup/2023`, and `terraform/backup/2024` directories.

## License

This actions is distributed by MIT License.
Please see [LICENSE](./LICENSE) file for more information.
