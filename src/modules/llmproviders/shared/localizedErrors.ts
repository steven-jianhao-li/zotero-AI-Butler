import { getString } from "../../../utils/locale";

export function providerMissingApiUrl(provider?: string): string {
  return provider
    ? getString("provider-error-api-url-missing-named", { args: { provider } })
    : getString("provider-error-api-url-missing");
}

export function providerMissingApiKey(provider?: string): string {
  return provider
    ? getString("provider-error-api-key-missing-named", { args: { provider } })
    : getString("provider-error-api-key-missing");
}

export function providerHttpRequestFailed(status: number | string): string {
  return getString("provider-error-http-request-failed", { args: { status } });
}

export function providerNoPdfFiles(): string {
  return getString("provider-error-no-pdf-files");
}

export function providerNoPdfProcessed(): string {
  return getString("provider-error-no-pdf-processed");
}

export function providerRequestFailed(provider: string): string {
  return getString("provider-error-request-failed", { args: { provider } });
}

export function providerStreamParseFailed(provider: string): string {
  return getString("provider-error-stream-parse-failed", {
    args: { provider },
  });
}

export function providerStreamTruncated(provider: string): string {
  return getString("provider-error-stream-truncated", { args: { provider } });
}

export function providerStreamMissingDone(provider: string): string {
  return getString("provider-error-stream-missing-done", {
    args: { provider },
  });
}

export function providerStreamUnexpectedEnd(
  provider: string,
  reason: string,
): string {
  return getString("provider-error-stream-unexpected-end", {
    args: { provider, reason },
  });
}
