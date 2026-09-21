# External consumer fixture — Rehearsal Tasks

The application used by the external-consumer rehearsal
(see `04-api/external-consumer-guide.md`). It is deliberately NOT a
workspace member: it has its own manifest, lockfile, and TypeScript
configuration, and installs only from vendored package tarballs.

To rehearse from scratch:

1. Pack the tarballs from a pinned checkout into `vendor/`
   (guide §1, or run `.github/scripts/verify-consumer.sh`, which does
   the entire loop).
2. `bun install`
3. `bun run typecheck && bun run build:app && bun run build:app:dev && bun run check:runtimes`

`vendor/` contents are regenerated, not committed. The committed
`bun.lock` records the tarball-based resolution.
