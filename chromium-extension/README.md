# Trilly Amazon

Load this folder as an unpacked extension in Chrome (or a Chromium browser).
Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
select this folder, and reload Trilly at `http://127.0.0.1:28753`.
Start collection with **Fetch Amazon details** in Trilly. The extension does
not collect data simply because it is installed or an Amazon tab is open.

The button scans Amazon.ca and Amazon.com payments in a separate, unfocused
window. Six order workers run alongside two payments readers (hard limit:
twelve owned tabs). Payments pagination overlaps order extraction. Tabs close
as their extracted records are handed off; only tabs created by this collector
are controlled or closed. **Stop** cancels collection. Login, Amazon challenges,
unrecognized pages, and timeouts pause affected tabs; use **Open page**, handle
the page yourself, then **Resume**. No credentials or cookies are exported.

The collector starts with the newest payments and stops after a page entirely
older than the oldest unapproved Amazon transaction minus 14 days, the last
page, or 100 pages per marketplace. Order links can point further into the past,
including for refunds. A repeated page pauses instead of looping. Orders are
deduplicated within a job; cached purchases refresh after 24 hours and refunds
request a fresh order. Fetch again after interruptions to retry missing work.

Collection state and unacknowledged packets use memory-only
`chrome.storage.session`, allowing the Manifest V3 worker to restart. The app
acknowledges each packet only after its authenticated backend saves it in the
encrypted vault. Locking, switching plans, or closing the Trilly tab cancels
collection; reloading Trilly stops the previous job and retains already saved
records. Restart with **Fetch Amazon details**. Nothing is stored in browser
localStorage, extension sync storage, or an external service.

The bridge checks Trilly's exact permanent origin in both the content script
and worker. It sends no YNAB token or vault credential to the extension. Amazon
content scripts inspect DOM only in collector-owned tabs. Product thumbnails
are fetched without credentials from two allowlisted Amazon image hosts and
transferred as bounded raster data URLs; Trilly does not load remote images.
Raw HTML, scripts, address blocks and Amazon account credentials are not stored.
Marketplace pages and thumbnails still make ordinary requests to Amazon.

The parser extends the working `bank-to-csv` payment card selectors and supports
the `data-component` order-detail layout on the supplied local references.
Localized layouts, changed markup, unsupported payment types, and missing
fields may require HTML paste or manual review. An empty or unrecognized page
is not reported as successfully collected. No live Amazon traversal has been
verified in an automated browser; tests use synthetic DOM and Chrome API mocks.

Run `pnpm test:amazon` for parser, matching, scheduler, cancellation, trust-boundary
and server-rendered card tests. These do not launch or control a browser.
