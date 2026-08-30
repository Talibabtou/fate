import type { LifecycleAction } from "../use-lifecycle-progress";

export function LifecyclePrompt({
  action,
  disabled,
  onAction,
}: {
  action: LifecycleAction;
  disabled: boolean;
  onAction: () => void;
}) {
  const label = action === "activate" ? "Activate draw" : "Settle draw";
  return (
    <button
      aria-label={label}
      className="quick-action lifecycle-action"
      disabled={disabled}
      onClick={onAction}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className="lifecycle-mark">
        {action === "activate" ? "▶" : "↗"}
      </span>
    </button>
  );
}
