# Proton icons

Official SVG artwork from [Proton](https://proton.me), downloaded 2026-09-27.
Mail and Calendar use the exact SVG favicons linked by their public login pages,
with their original transparency and no badge background:

- [Mail favicon](https://mail.proton.me/assets/static/favicon.d47d3d0bef6d338e377a.svg)
- [Calendar favicon](https://calendar.proton.me/assets/static/favicon.b4214437d532d78b0916.svg)

Keep these transparent favicons rather than the white-backed media-kit badges
or hand-drawn approximations. These files are bundled locally; displaying them
makes no requests to Proton.

The Settings brand mark is extracted from the icon variant of
[ProtonLogo.tsx](https://github.com/ProtonMail/WebClients/blob/914d7520eff52aafed9a1adfe19859143bdf1dc9/packages/components/components/logo/ProtonLogo.tsx).
Only JSX attributes and gradient IDs were converted to static SVG; geometry,
colors, gradients, and viewBox are preserved.
