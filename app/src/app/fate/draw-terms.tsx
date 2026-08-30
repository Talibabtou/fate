import type { DrawAccount } from "../../domain/fate";
import { formatSol } from "./fate-format";

export function DrawTerms({ draw }: { draw: DrawAccount | undefined }) {
  return (
    <details className="info-toggle">
      <summary>
        <span>View draw terms</span>
        <span className="toggle-icon" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="terms-grid">
        <Term label="Side odds" value="Player 90% · Staker 10%" />
        <Term
          label="Player max loss"
          value={draw ? `${formatSol(draw.playerTvlLamports)} SOL` : "—"}
        />
        <Term label="Player fee" value="5% of profit" />
        <Term label="Staker exposure" value="Principal can erode" />
        <p className="terms-note">
          The selected side is fixed first, then one wallet wins by its stored weight. Pending
          Player deposits can be refunded only during funding.
        </p>
      </div>
    </details>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="term-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
