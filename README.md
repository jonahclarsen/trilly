# Trilly

A local, keyboard-driven YNAB review queue. Rust serves a Svelte UI in your
browser. Transaction history, your YNAB token, pending edits, and undo history
live in one encrypted vault on your computer. No external categorization service.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/review-dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/review-light.webp">
  <img alt="Trilly transaction review with keyboard shortcuts and category suggestions" src="docs/screenshots/review-light.webp" width="1280">
</picture>

<details>
<summary>Settings preview</summary>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/settings-dark.webp">
  <img alt="Trilly settings with appearance circles, theme choices, font previews, and logo color controls" src="docs/screenshots/settings-light.webp" width="660">
</picture>
</details>

Screenshots use synthetic data and the default Iridescent theme. The previews follow your light/dark preference.

## Run

Requires macOS, Xcode Command Line Tools, Rust, Node.js, and pnpm.

```sh
pnpm install
pnpm start
```

Your browser opens at **http://127.0.0.1:28753**. Confirm the native macOS
Keychain password prompt, enter your YNAB personal access token in Settings,
and select a plan and account. There is no separate Trilly login or passphrase.
Your Mac password goes only into the macOS dialog; Trilly never receives it.
Use “Allow” for the current unlock rather than permanently trusting the process.

If an existing passphrase-protected vault is found, Trilly asks for its old
vault passphrase once, then requests macOS authorization to migrate it. A wrong
passphrase or cancelled native prompt leaves the original encrypted data intact.
The old encrypted file is retained as a backup when migrating from the previous
app directory. It still requires the old vault passphrase; keep that backup and
passphrase together in a safe place until you are satisfied with the migration.

`pnpm dev` builds the frontend and runs the debug Rust backend. Restart it after
source changes. `pnpm start` uses the optimized Rust build. Both bind only to
127.0.0.1 and use the permanent random port saved in `port.json`; there is no
separate frontend server or cloud host.

## Review

| Key | Action |
| --- | --- |
| Enter | Approve the current payee/category and advance |
| 1 / 2 / 3 | Apply that suggested pair, approve, and advance |
| C / P | Search categories / payees; Enter selects |
| S | Skip for this session |
| U | Undo the last approval |
| A | Choose account |
| R | Refresh metadata and sync |
| , | Settings |
| L | Lock |
| ? | Shortcut reference |

Approvals are saved locally before advancing. After three seconds without a new
approval, the app syncs the batch to YNAB. “Pending” means encrypted on disk but
not yet confirmed by YNAB. Closing or locking keeps those changes; unlocking
retries them. Network or rate-limit errors leave them pending for manual retry.
Undo persists a reverse operation so it also works if a previous response was
lost. Undo history keeps the most recent 100 approvals for the selected plan.

Each sync checks for changes made in YNAB before writing. Conflicts remain
pending until you discard the conflicting local edits and review again. YNAB
does not offer conditional transaction updates, so another edit between our
read and write is still possible; avoid editing the same transaction in both
apps simultaneously. Existing splits, transfers, reconciled transactions, and
loan transactions can be approved, but should be edited in YNAB. New payees
must currently be created there too. Pending bank transactions are not exposed
by YNAB's transactions endpoint.

The first import fetches history since 2000; later syncs use YNAB's delta cursor.
The account selector filters the review queue; suggestions use confirmed
history across the selected plan. Rankings consider imported merchant text,
payee, amount, account, matching memos, and recency. Corrections start informing
suggestions once YNAB confirms them. This is a local heuristic, not a claim of
better accuracy than YNAB. Sparse or ambiguous history can produce poor choices.

## Encryption and its limits

Trilly creates a random **256-bit encryption key** and stores it in the macOS
file-based Keychain. Its access control list has no trusted applications and
requires password entry before the key can be read. The same native Keychain
read is required on first setup, subsequent browser opens/reloads, and after a
lock. Cancelling does not create an authenticated browser session. The prompt
uses your default Keychain password, normally the same as your Mac login password.
This implementation uses the password prompt, not Touch ID or a Secure Enclave key.

The Rust backend verifies the Keychain access rules before reading the key and
rejects a key whose rules have been weakened. The Keychain enforces the access
restriction; it is not merely an authentication flag in Trilly. macOS's legacy
file-based Keychain APIs work with local Rust executables without requiring an
Apple Developer provisioning profile. A native test creates an isolated,
synthetic Keychain and verifies that even its creating process cannot silently
retrieve the key when UI interaction is disabled.

**XChaCha20-Poly1305** encrypts and authenticates the entire vault, including
transaction history, token, pending edits, and undo history. Each save uses a
fresh random 192-bit nonce. The format version and random key identifier are
also authenticated. The file contains no plaintext decryption key. An encrypted
temporary file, fsync, atomic rename, and directory fsync protect saves. Vaults
are mode 0600 inside a mode 0700 directory; an instance lock prevents concurrent
writers. A pending `.key-id` file contains only a random identifier, allowing a
cancelled first unlock to retry without creating more Keychain entries.

The encryption key and structured vault data are zeroized when the Rust session
locks. The browser retains only an in-memory session credential and the data it
needs to display. Reloading requires another native unlock. Only appearance and
logo preferences go in localStorage. Browser and backend both lock after six
hours of inactivity.

Host and Origin validation, a custom API header, authenticated private
endpoints, no browser caching, and a restrictive Content Security Policy protect
the local server. Browser traffic stays on HTTP loopback; YNAB traffic uses
HTTPS. There are no external categorization services, third-party scripts,
telemetry, or transaction/token logs.

**An unlocked app still handles plaintext.** A sufficiently privileged agent,
debugger, extension, or modified app could access it. Native authentication does
not isolate a running app from every process on your Mac. JavaScript and
HTTP-library buffers cannot reliably be wiped; OS swap/crash dumps are outside
Trilly's control. Use FileVault and a trusted browser, and lock Trilly before
asking an agent to work on it. [AGENTS.md](AGENTS.md) forbids inspection of real
vaults, Keychain secrets, unlocked browsers, and process memory.

Data lives at `~/Library/Application Support/trilly/data.vault`. Back up the
vault **and your Keychain** using a trusted Mac backup mechanism. A vault file
alone cannot be restored on another Mac without its corresponding Keychain key.
There is no application recovery-password bypass. Legacy passphrase vaults use
Argon2id (64 MiB, three iterations, one lane) only for the one-time migration.

## Themes

The eleven theme presets, daily Random selection, and light/dark palettes come
from the author's Balance app. Iridescent is the default; system appearance is
followed live. Settings offers Light, Dark, and System circles, and a Random
sub-button to start daily themes tomorrow. Theme choice can be changed while locked.

The logo has ten local sans serif font choices, weight controls, letter spacing,
and a color picker with hex and hue/saturation/lightness controls. Fonts load
from macOS without network requests. Payee and category pickers focus search
immediately; click outside any modal or press Escape to close it.
The compact layout also takes inspiration from the author's Compressor app.

## Contributing and screenshots

Do all work in a dedicated Git worktree. After completing a requested change,
verify and commit it, integrate it onto main, and push main to GitHub. Remove
the temporary worktree and branch afterward. Never commit or push secrets or
personal financial data; see [AGENTS.md](AGENTS.md) for the complete rules.

Whenever the UI changes, refresh the screenshots displayed in this README and
push them with the change:

```sh
pnpm screenshots
```

This builds the frontend, opens an isolated static preview with synthetic API
fixtures, and writes light/dark review and settings WebPs to `docs/screenshots/`.
It does not connect to the running app or start a backend. Review all WebP
images, update the README references or
captions when necessary, and commit and push them with the UI change so the
GitHub preview stays current. Never take documentation screenshots of real data.

## Verification

```sh
pnpm check
pnpm build
cargo test --manifest-path server/Cargo.toml
pnpm test:browser
```

Browser tests use an isolated temporary vault, a separate permanent random test
port, and a debug-only synthetic authentication provider. They never open the
real Keychain or interrupt the running app. Synthetic authentication is excluded
from normal builds and cannot compile in release mode. Chrome is used if
installed; otherwise install Playwright Chromium with
`pnpm exec playwright install chromium`. API fixtures, screenshots, passwords,
and encryption tests contain only synthetic data. Rust tests exercise actual
HTTP requests against a local mock YNAB server, including lost responses,
conflicts, delta sync, and undo. No real YNAB token is needed for tests.

The backend's `TRILLY_DATA_DIR` override exists for isolated testing. Never
point automated tests at the normal vault directory. `TRILLY_NO_OPEN=1 pnpm start`
runs the server without automatically opening a browser.

References: [YNAB API](https://api.ynab.com/),
[endpoint specification](https://api.ynab.com/papi/open_api_spec.yaml),
[macOS Keychain](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains),
[Argon2](https://docs.rs/argon2/0.5.3/argon2/),
[XChaCha20-Poly1305](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/).
