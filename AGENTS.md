# YNAB Plus

Local Rust backend, Svelte browser frontend. Use pnpm. The permanent loopback
port was chosen with a cryptographically secure random generator in port.json.

## Git workflow

Always do requested work in a dedicated Git worktree on a temporary branch.
Create the worktree before editing project files; do not develop in the main
checkout. Install dependencies there with pnpm install --frozen-lockfile.

After completing each requested change, verify it and commit it in the worktree.
Then integrate the finished change onto main, resolve any integration issues,
commit the integration if necessary, and push main to GitHub. Always commit and
push after requested work; do not leave completed changes uncommitted or unpushed.
Preserve unrelated user changes. Once main is pushed, remove the temporary
worktree and branch so the repository is clean.

## Never push secrets

Never commit or push secrets, API tokens, passwords, private keys, vaults,
personal financial data, logs, or screenshots containing real data. Check the
staged diff and scan repository history before publishing. Keep build outputs,
dependencies, test results, and local credentials ignored. If a secret is found,
remove it from every commit being published and arrange for its revocation;
deleting it from the latest version alone is not sufficient.

## Private data

Never read, decrypt, export, screenshot, or inspect the user's vault, token,
passphrase, unlocked browser, or process memory. Never retrieve keys from a
keychain. Use only synthetic fixtures, isolated test vaults, and test passwords.
Do not ask the user to put secrets in chat, source files, shell commands, or logs.
Do not add saved keys, automatic unlock, telemetry, or external AI services.

## UI

Reuse components; keep labels short and functional. Icons in buttons must be
SVGs. Keep shortcut handling and its reference together. Themes come from
Balance; Random is the default, with system light/dark appearance.

Whenever a requested change alters the UI, regenerate the README screenshots
with pnpm screenshots. Review the resulting WebP files in docs/screenshots,
update the README image references or captions as needed, and commit and push
the screenshots and README with the UI change so GitHub shows the current UI.
All published screenshots must be WebP and use only synthetic fixtures. Never
capture the user's running browser or unlocked app. The screenshot command
serves a separate static build with mocked API calls; it must not use a real vault.

## Verification

Run pnpm check, pnpm build, cargo test --manifest-path server/Cargo.toml, and
pnpm test:browser. Use synthetic data for all API and encryption checks.
Document material security limitations honestly in README.md.
