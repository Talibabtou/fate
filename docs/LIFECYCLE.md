# Fate lifecycle

Fate does not need a permanent worker to move a draw forward. A user action should trigger the next safe transition when that transition is due; a separate permissionless caller must remain able to do the same work when no user is ready to act.

## State flow

```text
FUNDING -> ACTIVATED -> LOCKED or AWAITING_RANDOMNESS -> SETTLED
                                               \-> VOIDED
SETTLED or VOIDED -> cleanup -> next FUNDING
```

`LOCKED` is retained for a staged randomness flow. The deterministic devnet path may settle an expired `ACTIVATED` draw directly and create the next draw in the same transaction.

## User-triggered progress

### Funding

The first Player deposit records the funding timestamp and Staker TVL snapshot. Later Player deposits remain refundable until activation. A deposit that reaches the live threshold activates the draw in that same transaction.

Stakers can withdraw during `FUNDING`. The withdrawal updates the snapshot, activation floor, and live threshold. If the new threshold is reachable, that same withdrawal activates the draw. The final active Staker cannot leave while Player funds remain.

If all Players refund, the program clears the funding timestamp and snapshot. Funding has no expiry.

### Activated

Activation freezes Staker positions and starts the five-minute countdown. Countdown Player deposits commit immediately at `1.00x` weight. Once the deadline passes, the current draw needs a permissionless settlement caller.

Before a connected user starts a new action, the client reads the confirmed current draw. If the current draw is due for activation, settlement, randomness recovery, or cleanup, the client presents that transition first. After confirmation, it rereads state and continues only if the user's requested action still applies.

The first transaction may be paid by that user when the UI clearly shows the fee payer, accounts, rent, and state change. The client must not hide an unrelated transition inside a signature request. If composition would make the result or account requirements unclear, use a separate transaction.

### Settlement and recovery

Any signer may submit a due settlement. The signer supplies the authenticated weighted paths and pays the transaction fee; the signer cannot select the side, winner, entropy value, or payout.

The program must accept a race-safe retry when another caller already advanced the draw. A stale blockhash gets a fresh blockhash. RPC failure must not change custody state or remove the user's refund, withdrawal, claim, or terminal recovery path.

Mainnet Entropy adds a staged flow: request or advance the Fate-owned variable, sample only a real target slot hash, reveal the provider seed, verify the commit, consume one generation, and settle. A missed slot or provider outage must lead to a bounded retry or void-and-refund path; it must never use a predictable fallback.

## Caller responsibilities

The caller, whether a connected user or a development script, should:

- read confirmed `Config` and `Draw` state;
- determine whether a transition is due from chain timestamps and phase;
- derive only the accounts required by that transition;
- simulate before submission, then confirm on the same RPC endpoint;
- reread affected accounts after confirmation;
- treat an already-applied race as success;
- leave all result selection and custody accounting to the program.

The caller must not scan every participant, choose a winner, reroll randomness, or use a privileged key. Cleanup refunds rent to the account's recorded payer.

## Pause and inactivity

Pause may stop new deposits and activation. It cannot stop Player refunds, Staker withdrawals, claims, due settlement, or terminal recovery.

No caller means no new transaction, not permission for anyone to seize funds. Once a user or public caller submits the due transition, the program must advance it without a privileged-caller requirement. The interface must never promise a draw will activate or settle at a particular wall-clock time.
