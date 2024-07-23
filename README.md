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
