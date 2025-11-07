import { LLMOptions, ProgressCb, ConversationMessage } from "./types";

export interface ILlmProvider {
  readonly id: string;

  generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string>;

  chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string>;

  testConnection(options: LLMOptions): Promise<string>;
}
