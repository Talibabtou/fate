import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { fatePublicConfig } from "./public-config";

export type FateWalletChain = "solana:devnet" | "solana:mainnet" | "solana:testnet";

export function privyWalletChain(): FateWalletChain | null {
  switch (fatePublicConfig.network?.toLowerCase()) {
    case "devnet":
      return "solana:devnet";
    case "mainnet":
    case "mainnet-beta":
      return "solana:mainnet";
    case "testnet":
      return "solana:testnet";
    default:
      return null;
  }
}

/** Sign a compiled @solana/kit transaction without letting Privy submit it. */
export async function signKitTransaction(
  wallet: ConnectedStandardSolanaWallet,
  transaction: Uint8Array,
): Promise<Uint8Array> {
  const chain = privyWalletChain();
  if (!chain) throw new Error("Privy external wallets require devnet, testnet, or mainnet");

  const result = await wallet.signTransaction({ transaction, chain });
  return result.signedTransaction;
}
