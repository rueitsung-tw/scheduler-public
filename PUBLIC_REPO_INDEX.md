# Public Repo Transfer Index

This index is the human-readable companion to [`public-repo.manifest.json`](./public-repo.manifest.json).
The manifest is the source of truth for what is allowed to land in the public working copy at `F:\scheduler-public`.

## Repository Role

- This repository is the public/open-source target copy.
- The private developer workspace is the source repository where local databases, debug payloads, unpublished notes, and other sensitive files may exist.
- `public-repo.manifest.json` is maintained as an allowlist snapshot so the public copy only receives files that have been explicitly classified as safe to publish.
- The sync script lives only in this public repository and reads the private source repository through `--source <path>`.
- The private source repository is read-only from the script's perspective: no writes, deletes, or renames are allowed there.

## Included Roots

- `src/`
- `constraints/`
- `prisma/`
- `public/`

## Included Root Files

- `.editorconfig`
- `.gitattributes`
- `.gitignore`
- `.oxlintrc.json`
- `.prettierrc.json`
- `PUBLIC_REPO_INDEX.md`
- `README.md`
- `eslint.config.js`
- `index.html`
- `jsconfig.json`
- `package-lock.json`
- `package.json`
- `phase2_engine.py`
- `preprocessor.py`
- `prisma.config.js`
- `prisma.config.ts`
- `public-repo.manifest.json`
- `scripts/public-repo-sync.mjs`
- `server.js`
- `solver.py`
- `terminal_sanitizer.py`
- `config.py`
- `utils.py`
- `vite.config.js`

## Stable Docs Kept for Public

- `docs/DataDictionary.md`
- `docs/Scheduler_Engine_Overview.md`
- `docs/藝才班特規排課模組_使用說明手冊.md`

## Public-Only Files

- `PUBLIC_REPO_INDEX.md`
- `public-repo.manifest.json`
- `scripts/public-repo-sync.mjs`
- `tests/`

These files are maintained directly in `F:\scheduler-public` and are preserved via the manifest's `targetOnlyFiles` / `targetOnlyRoots` rules.

## Excluded by Default

- Local runtime and secrets: `.env`, `dev.db`, `*.local`
- Build and cache output: `node_modules/`, `dist/`, `.venv/`, `venv/`, `__pycache__/`, `.pytest_cache/`
- Assistant/tooling folders: `.agent/`, `.agents/`, `.claude/`, `.cline/`, `.continue/`, `.github/`, `.vscode/`
- Debug and diagnostics: `debug_*`, `input_*.json`, `output*.json`, `fresh_db_dump.json`, `solver_log.txt`, `debug_lock_audit.txt`
- Helper scripts and backups: `analyze_payload.py`, `repair_agent.py`, `diagnose_*`, `verify_*`, `*_backup.py`, `cleanup_db.*`, `check_db.mjs`, `fetch_all_db.mjs`, `export_solver_input.mjs`
- Private docs/history: most other files under `docs/`

## Maintenance Rule

When a file changes in the private source repository:

1. Decide whether it belongs in public, private, or an explicitly ignored bucket.
2. Update `public-repo.manifest.json` in this public repository first if the file should be published.
3. Run `node scripts/public-repo-sync.mjs check --source "<private-source-path>"` from `F:\scheduler-public` until `Unclassified files: 0`.
4. Run `node scripts/public-repo-sync.mjs sync --source "<private-source-path>"` from `F:\scheduler-public` to copy the allowlisted files into this repository.
5. Review the resulting public repo diff, then commit and push the public repository.

## Important Behavior

- `node scripts/public-repo-sync.mjs check` audits the checked-in public tree when `--source` is omitted.
- `node scripts/public-repo-sync.mjs check --source "<private-source-path>"` classifies the private source tree without modifying it.
- `node scripts/public-repo-sync.mjs sync --source "<private-source-path>"` only writes inside `F:\scheduler-public`.
- `node scripts/public-repo-sync.mjs sync` without `--source` is rejected.
- `node scripts/public-repo-sync.mjs sync --source "F:\scheduler-public"` is rejected.
- `node scripts/public-repo-sync.mjs sync --source "<private-source-path>" --dry-run` prints planned copies and stale-file removals without mutating either tree.
