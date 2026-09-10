# Trilly

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
passphrase, unlocked browser, or process memory. Never retrieve the user's
Keychain keys. Use only synthetic fixtures, isolated
test vaults, temporary test Keychains, and test passwords.
Do not ask the user to put secrets in chat, source files, shell commands, or logs.
The user authorized permanent Keychain trust for certificate-signed Trilly
builds, including silent unlock across rebuilds and restarts. Trust only Trilly's
signing identity, never all applications. Lock clears the in-memory session;
it is not proof of user presence, and reload can reopen the vault silently.
Existing items may require one native approval to migrate decrypt access.
Preserve their encryption keys and owner ACLs. Never add telemetry or external
AI services. Never collect a macOS password in the browser or backend.
Native SecKeychainItemSetAccess can display authorization UI even after
SecKeychainSetUserInteractionAllowed(false). Automated repair tests must use
new synthetic items with explicitly editable fixture-owner ACLs. Never test
native repair authorization denial by opening a real macOS prompt; use a mock.
Do not change the real item's owner ACL to make tests or unlocks pass.

## UI

Reuse components; keep labels short and functional. Icons in buttons must be
SVGs. Keep shortcut handling and its reference together. Themes come from
Balance; Iridescent is the default, with system light/dark appearance and an
optional scheduled start for daily Random. The lowercase Trilly wordmark uses
Avenir Next with fixed −0.8px letter spacing. Settings offers a weight slider
from 100 to 900 in steps of 1 (default 750) beside the color controls. The default
color is `#56c2f0` in both appearances. Weight and color persist across reloads.
Use text labels with SVG icons, transparent backgrounds, and subtle outlines for the top navigation. Settings uses a clean gear SVG.

Whenever a requested change alters the UI, regenerate the README screenshots
with pnpm screenshots. Review the resulting WebP files in docs/screenshots,
update the README image references or captions as needed, and commit and push
the screenshots and README with the UI change so GitHub shows the current UI.
All published screenshots must be WebP and use only synthetic fixtures. Never
capture the user's running browser or unlocked app. The screenshot command
serves a separate static build with mocked API calls; it must not use a real vault.

## Verification

Do not run tests or screenshot workflows that launch/control browsers, access the
system clipboard, interact with Keychain, or display native UI without fresh,
explicit user authorization. These have disrupted the user's work. This restriction
overrides the browser, screenshot, and native-test requirements elsewhere in this
file. Use non-interactive static checks and builds; report any skipped verification.


Run pnpm check, pnpm build, cargo test --manifest-path server/Cargo.toml, and
pnpm test:browser. Use synthetic data for all API and encryption checks.
Document material security limitations honestly in README.md.

## Development identity and hot updates

`pnpm dev` serves Vite on the permanent app port and proxies API calls to the
separate loopback dev backend port in port.json. Svelte hot updates reuse the
in-memory browser session; Rust edits rebuild, sign, restart, and reload.
`pnpm start` installs and launches the release bundle; `pnpm install:app` only
installs it. Both use ~/Applications/Trilly.app with identifier app.trilly.
Signing uses an existing certificate identity selected by public metadata and
saved outside the repo in trilly-development/signing.json under Application
Support. Never export the signing key or silently switch to ad-hoc signing.
Run pnpm test:dev and pnpm test:signing for changes to these flows. Signed
Keychain tests use new synthetic items and disable native authorization UI.
The development browser tests temporarily edit and restore App.svelte and
server/src/main.rs to exercise the actual file watchers. Run them in the
dedicated worktree without concurrent edits to those files.
