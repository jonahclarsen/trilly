# YNAB Plus

Local Rust backend, Svelte browser frontend. Use pnpm. The permanent loopback
port was chosen with a cryptographically secure random generator in port.json.

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

## Verification

Run pnpm check, pnpm build, cargo test --manifest-path server/Cargo.toml, and
pnpm test:browser. Use synthetic data for all API and encryption checks.
Document material security limitations honestly in README.md.
