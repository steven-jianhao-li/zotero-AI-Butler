import type { ConversationMessage, LLMAbortSignal } from "./llmproviders/types";

export type ChatAbortControllerLike = {
  signal: LLMAbortSignal;
  abort(reason?: unknown): void;
};

function normalizeConversationMessage(
  message: ConversationMessage,
): ConversationMessage {
  return {
    role:
      message.role === "assistant"
        ? "assistant"
        : message.role === "system"
          ? "system"
          : "user",
    content: String(message.content ?? ""),
  };
}

export function buildQuickChatConversation(
  sessionHistory: ConversationMessage[],
  question: string,
): ConversationMessage[] {
  return [
    ...sessionHistory.map(normalizeConversationMessage),
    { role: "user", content: question },
  ];
}

export function appendQuickChatTurn(
  sessionHistory: ConversationMessage[],
  question: string,
  answer: string,
): ConversationMessage[] {
  return [
    ...sessionHistory.map(normalizeConversationMessage),
    { role: "user", content: question },
    { role: "assistant", content: answer },
  ];
}

export function createChatAbortController(): ChatAbortControllerLike {
  const NativeAbortController = (globalThis as any).AbortController;
  if (typeof NativeAbortController === "function") {
    return new NativeAbortController() as ChatAbortControllerLike;
  }

  let aborted = false;
  let reason: unknown;
  const listeners = new Set<() => void>();
  const signal: LLMAbortSignal = {
    get aborted() {
      return aborted;
    },
    get reason() {
      return reason;
    },
    addEventListener(type, listener, options) {
      if (type !== "abort") return;
      listeners.add(listener);
      if (aborted) {
        listener();
        if (
          options === true ||
          (typeof options === "object" && options?.once)
        ) {
          listeners.delete(listener);
        }
      }
    },
    removeEventListener(type, listener) {
      if (type !== "abort") return;
      listeners.forEach((registered) => {
        if (registered === listener) {
          listeners.delete(registered);
        }
      });
    },
    throwIfAborted() {
      if (aborted) {
        throw new Error(String(reason || "用户已终止追问"));
      }
    },
  };

  return {
    signal,
    abort(nextReason?: unknown) {
      if (aborted) return;
      aborted = true;
      reason = nextReason || "用户已终止追问";
      listeners.forEach((listener) => listener());
      listeners.clear();
    },
  };
}

export function isChatAbortError(
  error: unknown,
  signal?: LLMAbortSignal,
): boolean {
  return (
    signal?.aborted === true ||
    (error as { name?: string } | undefined)?.name === "LLMRequestAbortError" ||
    (error as { suppressTaskRetry?: boolean } | undefined)
      ?.suppressTaskRetry === true
  );
}
