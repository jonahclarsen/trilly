# YNAB Plus

A local, keyboard-driven YNAB review queue. Rust serves a Svelte UI in your
browser. Transaction history, your YNAB token, pending edits, and undo history
live in one encrypted vault on your computer. No external categorization service.

## Run

Requires Rust, Node.js, and pnpm.

```sh
pnpm install
pnpm start
```

Open **http://127.0.0.1:28753**. Create a passphrase, enter your personal access
token in Settings, and select a plan and account. Enter secrets only in the app,
not in a terminal, chat, or source file. The passphrase cannot be reset.

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

The vault uses **Argon2id** (64 MiB, three iterations, one lane) to derive a
256-bit key from your passphrase and a random 128-bit salt. **XChaCha20-Poly1305**
encrypts and authenticates the entire payload with a new random 192-bit nonce
on every save. The version and salt are authenticated too. Writes use an
encrypted temporary file, fsync, atomic rename, and directory fsync. Vault files
are mode 0600 inside a mode 0700 directory on Unix. A process lock prevents
two instances from writing the same vault.

The key and passphrase are not saved in a keychain, environment file, browser
storage, or source tree. The backend retains the derived key while unlocked
and zeroizes its key and structured vault data on lock. The browser keeps its
session credential only in memory; reloading requires unlocking again. The
only localStorage entry is the selected theme and light/dark preference.

Both browser and backend lock after ten minutes of inactivity. No transaction
or token logging, telemetry, third-party scripts, or external fonts are used.
The backend validates Host and Origin, requires a custom API header plus an
unlocked session credential for private endpoints, disables browser caching,
and uses a restrictive Content Security Policy. YNAB requests use HTTPS;
browser-to-backend requests use HTTP on loopback and never bind to the LAN.

**This protects locked files, not a compromised running computer.** An agent,
extension, debugger, or other process with access to the unlocked browser or
backend can potentially read plaintext. A process able to alter the app before
unlocking could capture the passphrase. JavaScript and HTTP-library buffers
cannot reliably be wiped; OS swap/crash dumps and browser password managers
are outside this app's control. Use full-disk encryption, a trusted browser,
and a strong unique passphrase. Lock the app before asking an agent to work on
it. `AGENTS.md` forbids inspecting real vaults, keys, unlocked sessions, and
screenshots; all verification uses synthetic data. That is an agent rule, not
a cryptographic restriction on a process with full machine access.

On macOS the encrypted file is
`~/Library/Application Support/ynab-plus/data.vault`. On other systems it is
inside the operating system's local data directory under `ynab-plus`.
Back up this file while the app is locked; keep the passphrase separately.
There is no recovery key or forgotten-passphrase bypass.

## Themes

The eleven theme presets, daily Random selection, and light/dark palettes are
copied from the owner's Balance app. Random is the default; system appearance
is followed live. Theme choice can be changed in Settings even while locked.
The compact layout also takes inspiration from the owner's Compressor app.

## Verification

```sh
pnpm check
pnpm build
cargo test --manifest-path server/Cargo.toml
pnpm test:browser
```

Browser tests use an isolated temporary vault and refuse to reuse an existing
server on the app's port. Stop the normal app before running them. Chrome is
used if installed; otherwise install Playwright Chromium with
`pnpm exec playwright install chromium`. API fixtures, screenshots, passwords,
and encryption tests contain only synthetic data. Rust tests exercise actual
HTTP requests against a local mock YNAB server, including lost responses,
conflicts, delta sync, and undo. No real YNAB token is needed for tests.

The backend's `YNAB_PLUS_DATA_DIR` override exists for isolated testing. Never
point automated tests at the normal vault directory.

References: [YNAB API](https://api.ynab.com/),
[endpoint specification](https://api.ynab.com/papi/open_api_spec.yaml),
[Argon2](https://docs.rs/argon2/0.5.3/argon2/),
[XChaCha20-Poly1305](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/).
