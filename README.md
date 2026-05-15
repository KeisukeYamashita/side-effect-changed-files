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
| `mapping` | YAML formatted mapping to match changed files. | No (when `auto` is set) | | See the examples |
| `mapping_file` | YAML file path to match changed files. Missing file is tolerated when `auto` is set. | No | `.github/side-effect.yml` | `./mapping.yml` |
| `matrix` | Output files in a format that can be used for GitHub Action's matrix strategy. It is alias of `json` with `true` and `escape_json` with `false`. It is intended to be enabled, when using the output as GitHub Actions matrix. | No | `false` | `true` |
| `merge` | Merge the matched files and the inputs (files passed by `files`). If `A` matched as a result of mapping from `B`, the output will include `A` and `B`. | No | `false` | `true` |
| `auto` | Auto-generate the mapping for a known ecosystem. The generated mapping is merged with `mapping` / `mapping_file` if provided. Currently supports `terraform`. | No | | `terraform` |

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

### Auto-generating the mapping (`auto`)

The `auto` input opts into ecosystem-specific mapping generators. The generated
entries are merged with anything you pass via `mapping` / `mapping_file`, so
you can mix auto and hand-written rules.

#### Terraform

When working with Terraform, hand-maintaining a mapping that lists every module
consumer is tedious. Pass `auto: terraform` and the action will scan the
repository for `*.tf` files, extract `module "..." { source = "..." }` blocks
with local sources (`./...`, `../...`), and produce a mapping where a change to
files under a referenced module's directory causes the consuming directories'
tf files to appear in the output.

```yaml
- uses: tj-actions/changed-files@v44
  id: raw-changed-files
  with:
    files: '**/*.tf'

- name: Detect impacted Terraform stacks
  id: changed-files
  uses: KeisukeYamashita/side-effect-changed-files@v1
  with:
    files: ${{ steps.raw-changed-files.outputs.all_changed_files }}
    auto: terraform
    dir_names: 'true'
```

For example, given:

```text
envs/prod/main.tf   # module "foo" { source = "../../modules/foo" }
modules/foo/main.tf
```

a change to `modules/foo/main.tf` produces `envs/prod` in the output.

**Remote sources are grouped as equivalence classes.** Modules referenced via a
non-local source (`github.com/...`, `git::...`, the Terraform Registry, etc.)
don't exist as files in this repository, so they're handled by grouping every
consumer that uses the *same exact source string*. A change to any one
consumer in the group then triggers all the others. The source string is the
identity, so different `?ref=` values are intentionally treated as different
modules.

```text
envs/prod/main.tf      # module "vpc" { source = "github.com/acme/tf//vpc?ref=v1.0.0" }
envs/staging/main.tf   # module "vpc" { source = "github.com/acme/tf//vpc?ref=v1.0.0" }
```

Bumping the `?ref=` in `envs/prod/main.tf` produces both `envs/prod` and
`envs/staging` in the output.

**Self-referencing git sources without `?ref=` are resolved to the working
tree.** A common pattern is to call a module from the same repository via its
github URL without pinning a ref:

```hcl
module "vpc" {
  source = "github.com/acme/infra//modules/vpc"
}
```

Terraform itself resolves this against the default branch, but for the purpose
of change detection the action treats it as if it were the local path
`modules/vpc` — so editing a file under `modules/vpc/` triggers every consumer
that references it this way, exactly like a `../../modules/vpc` local source
would. The check uses the GitHub Actions environment, so it works on GHE too:

- Repository identity comes from `GITHUB_REPOSITORY` (e.g. `acme/infra`).
- Host comes from `GITHUB_SERVER_URL` (e.g. `https://ghe.example.com` for
  GitHub Enterprise; defaults to `github.com`).
- Sources with any `?ref=...` (commit SHA, tag, branch) are *not* treated as
  self-references and continue to be grouped by exact-string equivalence.
- `git::https://...`, `git::ssh://...`, and `git@host:owner/repo` SSH forms are
  recognized in addition to the bare `host/owner/repo` form.

When the environment variables are unset (e.g. running locally outside of
Actions), self-reference detection is silently skipped.

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
