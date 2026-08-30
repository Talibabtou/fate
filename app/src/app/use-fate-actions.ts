import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { type Address, address, type Instruction } from "@solana/kit";
import { useRef, useState } from "react";
import {
  claimPlayerInstruction,
  claimStakeWithdrawalInstruction,
  DrawPhase,
  depositPlayerInstruction,
  depositStakeInstruction,
  permissionlessProgressInstruction,
  refundPlayerInstruction,
  requestStakeWithdrawalInstruction,
} from "../domain/fate/index.ts";
import { readDevSettlementParticipants } from "../features/fate/data/settlement-participants.ts";
import type { FateSnapshot } from "../features/fate/data/snapshot.ts";
import { isRetryableRpcError } from "../lib/rpc/client.ts";
import { executeFateTransaction, type FateTransactionState } from "../lib/transactions/index.ts";
import { isLifecycleAlreadyAdvanced, parseShares, parseSolAmount } from "./fate-action-rules.ts";
import {
  getLifecycleAction,
  type LifecycleAction,
  type LifecycleCheck,
} from "./use-lifecycle-progress.ts";
import type { WalletStatus } from "./use-wallet-session.tsx";

export type ReviewAction =
  | { kind: "deposit"; side: "player" | "staker"; amountLamports: bigint; amountLabel: string }
  | { kind: "refund"; amountLamports: bigint; amountLabel: string }
  | { kind: "withdraw"; shares: bigint; amountLabel: string }
  | { kind: "claim"; amountLamports: bigint; amountLabel: string }
  | { kind: "claim-withdrawal"; amountLamports: bigint; amountLabel: string }
  | { kind: "progress"; action: LifecycleAction; drawId: bigint; amountLabel: string };

type SecondaryActionKind = Exclude<ReviewAction["kind"], "deposit" | "progress">;

export function useFateActions({
  amount,
  beforeUserAction,
  isPlayer,
  network,
  programAddress,
  refresh,
  snapshot,
  wallet,
  walletStatus,
  withdrawalShares,
  onWithdrawalSharesChange,
}: {
  amount: string;
  beforeUserAction: () => Promise<LifecycleCheck>;
  isPlayer: boolean;
  network: string;
  programAddress: Address | null;
  refresh: () => Promise<FateSnapshot | null>;
  snapshot: FateSnapshot | null;
  wallet: ConnectedStandardSolanaWallet | null;
  walletStatus: WalletStatus;
  withdrawalShares: string;
  onWithdrawalSharesChange: (value: string) => void;
}) {
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [txState, setTxState] = useState<FateTransactionState | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const confirming = useRef(false);
  const interactionLock = useRef(false);

  const transactionBusy =
    preparing ||
    txState === "simulating" ||
    txState === "awaiting-signature" ||
    txState === "submitted";

  async function prepareUserAction() {
    if (interactionLock.current) return null;
    interactionLock.current = true;
    setPreparing(true);
    try {
      const check = await beforeUserAction();
      if (check.dueAction) {
        openReview(
          {
            kind: "progress",
            action: check.dueAction,
            drawId: check.snapshot?.draw.id ?? 0n,
            amountLabel: "No pool funds transferred",
          },
          check.snapshot,
        );
        setTxMessage("Advance the due draw transition before starting another action.");
        return null;
      }
      return check.snapshot ?? snapshot;
    } finally {
      setPreparing(false);
      interactionLock.current = false;
    }
  }

  async function beginPrimaryAction() {
    setTxMessage(null);
    setTxState(null);
    if (!wallet || walletStatus !== "connected") {
      setTxMessage("Connect a Solana wallet on the configured network first.");
      return;
    }
    const currentSnapshot = await prepareUserAction();
    const currentDraw = currentSnapshot?.draw;
    if (!currentSnapshot || !currentDraw) {
      setTxMessage("Live Fate state is not available yet.");
      return;
    }
    let amountLamports: bigint;
    try {
      amountLamports = parseSolAmount(amount);
    } catch (nextError) {
      setTxMessage(nextError instanceof Error ? nextError.message : "Enter a valid SOL amount.");
      return;
    }
    const minimum = isPlayer ? 10_000_000n : 100_000_000n;
    if (amountLamports < minimum) {
      setTxMessage(
        `Minimum ${isPlayer ? "Player" : "Staker"} deposit is ${isPlayer ? "0.01" : "0.10"} SOL.`,
      );
      return;
    }
    if (isPlayer) {
      if (currentDraw.phase !== DrawPhase.Funding && currentDraw.phase !== DrawPhase.Activated) {
        setTxMessage("Player deposits are closed for this draw.");
        return;
      }
      if (
        currentDraw.phase === DrawPhase.Activated &&
        currentDraw.locksAt > 0n &&
        BigInt(Math.floor(Date.now() / 1000)) >= currentDraw.locksAt
      ) {
        setTxMessage("The countdown has reached its lock time.");
        return;
      }
    } else if (
      currentDraw.phase !== DrawPhase.Funding ||
      currentDraw.firstPlayerAt > 0n ||
      currentSnapshot.config.paused
    ) {
      setTxMessage("New Staker deposits are open only during unfunded Funding.");
      return;
    }
    openReview(
      {
        kind: "deposit",
        side: isPlayer ? "player" : "staker",
        amountLamports,
        amountLabel: `${formatSol(amountLamports)} SOL`,
      },
      currentSnapshot,
    );
  }

  async function beginSecondaryAction(kind: SecondaryActionKind) {
    setTxMessage(null);
    setTxState(null);
    if (!snapshot || !wallet || walletStatus !== "connected") {
      setTxMessage("Connect a Solana wallet and wait for live Fate state.");
      return;
    }
    const currentSnapshot = await prepareUserAction();
    const currentDraw = currentSnapshot?.draw;
    if (!currentSnapshot || !currentDraw) {
      setTxMessage("Live Fate state is not available yet.");
      return;
    }
    if (kind === "refund" && currentSnapshot.playerPosition?.refundableLamports) {
      openReview(
        {
          kind,
          amountLamports: currentSnapshot.playerPosition.refundableLamports,
          amountLabel: `${formatSol(currentSnapshot.playerPosition.refundableLamports)} SOL`,
        },
        currentSnapshot,
      );
    } else if (kind === "claim" && currentSnapshot.playerPosition?.claimableLamports) {
      openReview(
        {
          kind,
          amountLamports: currentSnapshot.playerPosition.claimableLamports,
          amountLabel: `${formatSol(currentSnapshot.playerPosition.claimableLamports)} SOL`,
        },
        currentSnapshot,
      );
    } else if (kind === "withdraw" && currentSnapshot.stakerPosition?.activeShares) {
      let shares: bigint;
      try {
        shares = parseShares(withdrawalShares, currentSnapshot.stakerPosition.activeShares);
      } catch (nextError) {
        setTxMessage(nextError instanceof Error ? nextError.message : "Enter valid shares.");
        return;
      }
      openReview({ kind, shares, amountLabel: `${shares} shares` }, currentSnapshot);
    } else if (
      kind === "claim-withdrawal" &&
      currentSnapshot.stakerPosition?.claimableWithdrawalLamports
    ) {
      openReview(
        {
          kind,
          amountLamports: currentSnapshot.stakerPosition.claimableWithdrawalLamports,
          amountLabel: `${formatSol(currentSnapshot.stakerPosition.claimableWithdrawalLamports)} SOL`,
        },
        currentSnapshot,
      );
    }
  }

  async function beginProgressAction() {
    setTxMessage(null);
    setTxState(null);
    if (!wallet || walletStatus !== "connected") {
      setTxMessage("Connect a Solana wallet and wait for live Fate state.");
      return;
    }
    const check = await beforeUserAction();
    if (!check.snapshot || !check.dueAction) {
      setTxMessage("This draw does not need a lifecycle transition yet.");
      return;
    }
    openReview(
      {
        kind: "progress",
        action: check.dueAction,
        drawId: check.snapshot.draw.id,
        amountLabel: "No pool funds transferred",
      },
      check.snapshot,
    );
  }

  async function confirmReview() {
    if (confirming.current || !review || !wallet || !snapshot) return;
    confirming.current = true;
    setTxState("simulating");
    try {
      const latestSnapshot = await refresh();
      if (!latestSnapshot) throw new StaleActionError("Live Fate state could not be refreshed");
      if (isLifecycleAlreadyAdvanced(review, latestSnapshot)) {
        setReview(null);
        setTxState("confirmed");
        setTxMessage("Lifecycle already advanced by another caller; live state refreshed.");
        return;
      }
      validateReview(review, latestSnapshot, network);
      if (!programAddress) {
        throw new Error("Fate public configuration is invalid or incomplete.");
      }
      const walletAddress = address(wallet.address);
      let instruction: Instruction;
      if (review.kind === "progress") {
        const participants =
          review.action === "settle"
            ? await readDevSettlementParticipants(latestSnapshot.draw)
            : undefined;
        instruction = await permissionlessProgressInstruction(
          review.action,
          programAddress,
          walletAddress,
          latestSnapshot.config,
          participants,
        );
      } else if (review.kind === "deposit") {
        instruction =
          review.side === "player"
            ? await depositPlayerInstruction(
                programAddress,
                walletAddress,
                latestSnapshot.draw.id,
                latestSnapshot.playerPosition?.leafIndex ?? latestSnapshot.draw.nextPlayerIndex,
                review.amountLamports,
              )
            : await depositStakeInstruction(
                programAddress,
                walletAddress,
                latestSnapshot.draw.id,
                latestSnapshot.stakerPosition?.leafIndex ?? latestSnapshot.vault.nextPositionIndex,
                review.amountLamports,
              );
      } else if (review.kind === "refund") {
        instruction = await refundPlayerInstruction(
          programAddress,
          walletAddress,
          latestSnapshot.draw.id,
          latestSnapshot.playerPosition?.leafIndex ?? 0n,
        );
      } else if (review.kind === "withdraw") {
        instruction = await requestStakeWithdrawalInstruction(
          programAddress,
          walletAddress,
          latestSnapshot.draw.id,
          latestSnapshot.stakerPosition?.leafIndex ?? 0n,
          review.shares,
        );
      } else if (review.kind === "claim") {
        instruction = await claimPlayerInstruction(
          programAddress,
          walletAddress,
          latestSnapshot.draw.id,
        );
      } else {
        instruction = await claimStakeWithdrawalInstruction(programAddress, walletAddress);
      }
      const result = await executeFateTransaction({ instruction, wallet, onState: setTxState });
      const refreshed = await refresh();
      setReview(null);
      if (review.kind === "withdraw") onWithdrawalSharesChange("");
      setTxMessage(
        refreshed
          ? `Confirmed ${result.signature.slice(0, 8)}…`
          : `Confirmed ${result.signature.slice(0, 8)}… Live state refresh is pending.`,
      );
    } catch (nextError) {
      const racedSnapshot = await refresh().catch(() => null);
      if (racedSnapshot && isLifecycleAlreadyAdvanced(review, racedSnapshot)) {
        setReview(null);
        setTxState("confirmed");
        setTxMessage("Lifecycle already advanced by another caller; live state refreshed.");
        return;
      }
      const message = nextError instanceof Error ? nextError.message : "Transaction failed";
      if (nextError instanceof StaleActionError) setReview(null);
      setTxState(
        nextError instanceof StaleActionError ||
          message.includes("timed out") ||
          isRetryableRpcError(nextError)
          ? "stale"
          : "failed",
      );
      setTxMessage(message);
    } finally {
      confirming.current = false;
    }
  }

  function cancelReview() {
    setReview(null);
    setTxMessage(null);
    setTxState(null);
  }

  function openReview(nextReview: ReviewAction, currentSnapshot: FateSnapshot | null) {
    if (!currentSnapshot) return;
    setReview(nextReview);
  }

  return {
    beginPrimaryAction,
    beginProgressAction,
    beginSecondaryAction,
    cancelReview,
    confirmReview,
    review,
    transactionBusy,
    txMessage,
    txState,
  };
}

class StaleActionError extends Error {}

function validateReview(review: ReviewAction, snapshot: FateSnapshot, network: string) {
  if (review.kind === "progress") {
    const action = getLifecycleAction(
      snapshot.config,
      snapshot.draw,
      network,
      BigInt(Math.floor(Date.now() / 1000)),
    );
    if (action !== review.action) {
      throw new StaleActionError(
        "The lifecycle transition was already advanced; refresh and review again.",
      );
    }
  } else if (review.kind === "deposit" && review.side === "player") {
    if (snapshot.draw.phase !== DrawPhase.Funding && snapshot.draw.phase !== DrawPhase.Activated) {
      throw new StaleActionError("Player deposits are closed for this draw.");
    }
    if (
      snapshot.draw.phase === DrawPhase.Activated &&
      snapshot.draw.locksAt > 0n &&
      BigInt(Math.floor(Date.now() / 1000)) >= snapshot.draw.locksAt
    ) {
      throw new StaleActionError("The countdown has reached its lock time.");
    }
  } else if (review.kind === "deposit") {
    if (
      snapshot.draw.phase !== DrawPhase.Funding ||
      snapshot.draw.firstPlayerAt > 0n ||
      snapshot.config.paused
    ) {
      throw new StaleActionError("New Staker deposits are no longer open.");
    }
  } else if (review.kind === "refund" && !snapshot.playerPosition?.refundableLamports) {
    throw new StaleActionError("The Player position is no longer refundable.");
  } else if (review.kind === "claim" && !snapshot.playerPosition?.claimableLamports) {
    throw new StaleActionError("The Player claim is no longer available.");
  } else if (
    review.kind === "withdraw" &&
    (!snapshot.stakerPosition || snapshot.stakerPosition.activeShares < review.shares)
  ) {
    throw new StaleActionError("The Staker position changed; review the withdrawal again.");
  } else if (
    review.kind === "claim-withdrawal" &&
    !snapshot.stakerPosition?.claimableWithdrawalLamports
  ) {
    throw new StaleActionError("The Staker withdrawal claim is no longer available.");
  }
}

function formatSol(lamports: bigint) {
  return (Number(lamports) / 1_000_000_000).toFixed(2);
}
