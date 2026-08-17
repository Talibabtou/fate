# Fate Development

Fate is developed against Solana devnet. Do not use a funded mainnet keypair for local development, deployment, or keeper work.

## Toolchain

The initial development baseline is:

- Node.js 24
- pnpm 11.5.2 or newer within major version 11
- Python 3.9 or newer
- Rust 1.85.0 (pinned by `rust-toolchain.toml` to match the Entropy reference)
- Solana CLI 3.0.15
- Steel CLI 3.0.3
- GitHub CLI 2.95.0 or newer

The Solana and Steel versions are the installed starting point. Revalidate and pin them when the first program build passes; do not upgrade either independently during program work.

Check the local tools:

```bash
node --version
pnpm --version
python3 --version
rustc --version
solana --version
steel --version
gh --version
```

## Environment

Copy `.env.example` to `.env.local` after the app is scaffolded and fill in devnet-only values. The example documents the intended split:

- `NEXT_PUBLIC_*` values may be included in the browser bundle.
- Keeper RPC values and `KEEPER_KEYPAIR_PATH` are server-only.
- Authority, treasury, keeper keypairs, RPC credentials, and Privy secrets must never be committed.

Use a low-balance keeper keypair that is separate from the development authority and treasury. Keep transaction submission and confirmation on the same RPC endpoint.

## Current checks

The simulator is the only executable component until the simulation gate in `BUILD_PLAN.md` passes.

```bash
PYTHONPYCACHEPREFIX=/tmp/fate-pycache python3 -m py_compile \
  data-simulation/simulate.py data-simulation/run_scenarios.py
```

After the revised simulator is accepted, its scenario command is:

```bash
PYTHONPYCACHEPREFIX=/tmp/fate-pycache python3 \
  data-simulation/run_scenarios.py --data-dir data-simulation
```

Program and app commands will be added at the root when those workspaces are scaffolded.
