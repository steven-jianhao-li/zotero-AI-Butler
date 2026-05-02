import type { LLMOptions } from "../types";

export type ConnectionTestMode = "text" | "pdf-base64";

export type ConnectionTestInput = {
  mode: ConnectionTestMode;
  text: string;
  isBase64: boolean;
  pdfBase64?: string;
};

export const CONNECTION_TEST_TEXT =
  "Please respond with 'OK' to confirm connection.";

const CONNECTION_TEST_PDF_PROMPT =
  "Read the attached PDF and follow its instruction.";

// 530-byte one-page PDF containing only CONNECTION_TEST_TEXT.
const CONNECTION_TEST_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjYwIDgwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4+Pj4+L0NvbnRlbnRzIDQgMCBSPj5lbmRvYmoKNCAwIG9iajw8L0xlbmd0aCA3ND4+c3RyZWFtCkJUL0YxIDkgVGYgMTAgNDAgVGQoUGxlYXNlIHJlc3BvbmQgd2l0aCAnT0snIHRvIGNvbmZpcm0gY29ubmVjdGlvbi4pVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MiAwMDAwMCBuIAowMDAwMDAwMTAxIDAwMDAwIG4gCjAwMDAwMDAyNTIgMDAwMDAgbiAKdHJhaWxlcjw8L1NpemUgNS9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjM3MQolJUVPRgo=";

export function getConnectionTestMode(options: LLMOptions): ConnectionTestMode {
  return options.vendorOptions?.connectionTestMode === "pdf-base64"
    ? "pdf-base64"
    : "text";
}

export function getConnectionTestInput(
  options: LLMOptions,
): ConnectionTestInput {
  const mode = getConnectionTestMode(options);
  if (mode === "pdf-base64") {
    return {
      mode,
      text: CONNECTION_TEST_PDF_PROMPT,
      isBase64: true,
      pdfBase64: CONNECTION_TEST_PDF_BASE64,
    };
  }

  return {
    mode,
    text: CONNECTION_TEST_TEXT,
    isBase64: false,
  };
}

export function getConnectionTestModeLabel(mode: ConnectionTestMode): string {
  return mode === "pdf-base64" ? "PDF Base64" : "Text";
}
