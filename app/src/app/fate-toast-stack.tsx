"use client";

import type { CSSProperties, FocusEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FateTransactionState } from "../lib/transactions";

const MAX_TOASTS = 5;
const TOAST_LIFETIME_MS = 10_000;
const TOAST_EXIT_MS = 180;

type ToastTone = "error" | "info" | "success";
type ToastPhase = "entering" | "exiting";

type ToastItem = {
  createdAt: number;
  id: string;
  message: string;
  phase: ToastPhase;
  tone: ToastTone;
};

type ToastInput = Pick<ToastItem, "id" | "message" | "tone">;

export function FateToastStack({
  error,
  transactionMessage,
  transactionState,
}: {
  error: string | null;
  transactionMessage: string | null;
  transactionState: FateTransactionState | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const removalTimers = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => {
      const target = current.find((toast) => toast.id === id);
      if (!target || target.phase === "exiting") return current;
      return current.map((toast) =>
        toast.id === id ? { ...toast, phase: "exiting" as const } : toast,
      );
    });

    if (removalTimers.current.has(id)) return;
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      removalTimers.current.delete(id);
    }, TOAST_EXIT_MS);
    removalTimers.current.set(id, timer);
  }, []);

  useEffect(() => {
    const incoming: ToastInput[] = [];
    if (error) {
      incoming.push({
        id: `live-error:${error}`,
        message: `Live state unavailable: ${error}. Check the configured RPC and deployed program ID.`,
        tone: "error",
      });
    }
    if (transactionMessage) {
      incoming.push({
        id: `transaction:${transactionState ?? "notice"}:${transactionMessage}`,
        message: transactionMessage,
        tone:
          transactionState === "failed" || transactionState === "stale"
            ? "error"
            : transactionState === "confirmed"
              ? "success"
              : "info",
      });
    }
    if (incoming.length === 0) return;

    setToasts((current) => {
      const currentIds = new Set(current.map((toast) => toast.id));
      const additions = incoming
        .filter((toast) => !currentIds.has(toast.id))
        .map((toast) => ({ ...toast, createdAt: Date.now(), phase: "entering" as const }));
      if (additions.length === 0) return current;
      return [...current, ...additions].slice(-MAX_TOASTS);
    });
  }, [error, transactionMessage, transactionState]);

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.phase !== "exiting")
      .map((toast) =>
        window.setTimeout(
          () => dismissToast(toast.id),
          Math.max(0, TOAST_LIFETIME_MS - (Date.now() - toast.createdAt)),
        ),
      );

    return () => {
      timers.forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, [dismissToast, toasts]);

  useEffect(
    () => () => {
      removalTimers.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
    },
    [],
  );

  function handleBlur(event: FocusEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setExpanded(false);
    }
  }

  if (toasts.length === 0) return null;

  return (
    <section
      aria-label="Notifications"
      className="toast-stack"
      data-expanded={expanded}
      onBlurCapture={handleBlur}
      onFocusCapture={() => setExpanded(true)}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {toasts
        .slice()
        .reverse()
        .map((toast, index) => (
          <div
            className="toast-item"
            data-phase={toast.phase}
            key={toast.id}
            style={{ "--toast-index": index } as CSSProperties}
          >
            <article
              aria-live={toast.tone === "error" ? "assertive" : "polite"}
              className={`toast-card is-${toast.tone}`}
              data-phase={toast.phase}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <span>{toast.message}</span>
              <button
                aria-label="Dismiss notification"
                className="toast-close"
                onClick={() => dismissToast(toast.id)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </article>
          </div>
        ))}
    </section>
  );
}
