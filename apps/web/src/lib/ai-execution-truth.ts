/** Queue acceptance is not evidence that the worker has invoked the Director. */
export function pendingAiExecutionProjection() {
  return {
    aiInvoked: null,
    aiExecutionStatus: "PENDING_RUNTIME_EVIDENCE" as const,
  };
}
