# Public Repo Transfer Index

This index is the human-readable companion to [`public-repo.manifest.json`](./public-repo.manifest.json).
The manifest is the source of truth for syncing the public working copy at `F:\scheduler-public`.

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

## Excluded by Default

- Local runtime and secrets: `.env`, `dev.db`, `*.local`
- Build and cache output: `node_modules/`, `dist/`, `.venv/`, `venv/`, `__pycache__/`, `.pytest_cache/`
- Assistant/tooling folders: `.agent/`, `.agents/`, `.claude/`, `.cline/`, `.continue/`, `.github/`, `.vscode/`
- Debug and diagnostics: `debug_*`, `input_*.json`, `output*.json`, `fresh_db_dump.json`, `solver_log.txt`, `debug_lock_audit.txt`
- Helper scripts and backups: `analyze_payload.py`, `repair_agent.py`, `diagnose_*`, `verify_*`, `*_backup.py`, `cleanup_db.*`, `check_db.mjs`, `fetch_all_db.mjs`, `export_solver_input.mjs`
- Private docs/history: most other files under `docs/`

## Maintenance Rule

When a new file is meant to be public:

1. Add it to `public-repo.manifest.json`
2. Re-run `node scripts/public-repo-sync.mjs check`
3. Sync to `F:\scheduler-public`

