export function formatRpcError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
    try {
      return JSON.stringify(error);
    } catch {
      return "RPC transaction error";
    }
  }
  return "RPC transaction error";
}
