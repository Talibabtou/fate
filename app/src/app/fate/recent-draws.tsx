import type { ConfigAccount } from "../../domain/fate";

export function RecentDraws({ config }: { config: ConfigAccount | undefined }) {
  return (
    <details className="info-toggle">
      <summary>
        <span>Recent draws & disclosures</span>
        <span className="toggle-icon" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="history-row">
        <div>
          <span className="context-label">Recent settled draws</span>
          <p>
            {config?.recentDrawIds.length
              ? config.recentDrawIds
                  .slice(0, 5)
                  .map((id) => `#${id}`)
                  .join(" · ")
              : "No settled draws yet"}
          </p>
        </div>
        <p className="terms-note">Native SOL only. Fate is not a guaranteed-principal product.</p>
      </div>
    </details>
  );
}
