# Continuous integration

The `Checks` workflow is the repository's merge gate. It runs on pull requests,
pushes to `main`, and manual dispatches. It cancels older runs for the same
branch or pull request so stale work does not consume the full build matrix.

The gates are deliberately split:

- `Repository checks` installs the frozen pnpm lockfile and runs Biome across
  the repository, TypeScript checks, app tests, Rust formatting, and simulator
  checks.
- `Web build and smoke` builds the Next.js app and requests the production page
  from `next start`.
- `Program and artifact checks` runs host Rust tests, the serial SBF lifecycle
  test, the localnet SBF build, the production Steel build, and verifies that
  `target/deploy/fate.so` exists.

Configure branch protection on `main` to require all three job names, require a
pull request, dismiss stale approvals, and prevent direct pushes. The workflow
does not deploy anything. When Vercel deployment is added, it should be a
separate job that requires the web and repository gates and is limited to the
intended repository events. The keeper remains a long-lived worker and should
not run inside Vercel.
