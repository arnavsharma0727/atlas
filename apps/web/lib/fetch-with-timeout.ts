/** Bound headers AND body; no excerpts are parsed or retained by this transport guard. */
export function withFetchTimeout(fetcher: typeof fetch, timeoutMs = 12_000, maxResponseBytes = 8 * 1024 * 1024): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("Source request bounds must be positive finite values.");
  }
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timeoutError = new Error(`Source request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    const externalSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

    const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectAborted: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    try {
      controller.signal.throwIfAborted();
      response = await Promise.race([fetcher(input, { ...init, signal: controller.signal }), aborted]);
      if (response.body) {
        // Drain a clone under the same deadline. The original's tee is then
        // fully buffered and bounded, preserving its URL, redirect metadata,
        // headers, identity and normal json/text consumption for adapters.
        reader = response.clone().body!.getReader();
        let receivedBytes = 0;
        for (;;) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > maxResponseBytes) {
            throw new Error("Source response exceeded the bounded byte limit; no oversized response is displayed.");
          }
        }
      }
      return response;
    } catch (cause) {
      controller.abort(cause);
      // Cancel both tee branches together. Awaiting one branch first can hang
      // until the other branch is canceled, especially in mocked streams.
      void reader?.cancel(cause).catch(() => undefined);
      void response?.body?.cancel(cause).catch(() => undefined);
      if (controller.signal.reason === timeoutError) throw timeoutError;
      throw cause;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromCaller);
      if (rejectAborted) controller.signal.removeEventListener("abort", rejectAborted);
    }
  };
}
