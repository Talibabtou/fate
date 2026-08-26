"use client";

import type { Address } from "@solana/kit";

export function FateFooter({
  network,
  programAddress,
}: {
  network: string;
  programAddress: Address | null;
}) {
  return (
    <footer className="fate-footer">
      <span>{network} preview · confirm every transaction in your wallet</span>
      <span className="mono">{programAddress?.slice(0, 8) ?? "program not configured"}</span>
    </footer>
  );
}
