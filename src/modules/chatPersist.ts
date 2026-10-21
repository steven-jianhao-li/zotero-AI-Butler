// === AI_BUTLER_CHAT_PERSIST_V1 ===
// Per-item quick-chat threads stored under the Zotero profile.

import { getString } from "../utils/locale";
import type { LLMNoteMetadata } from "./llmNoteMetadata";
import type {
  QuickChatRelatedItemRef,
  QuickChatRelatedMode,
} from "./quickChatRelatedContext";

export type ChatPersistRole = "system" | "user" | "assistant";

export type ChatPersistMessage = {
  role: ChatPersistRole;
  content: string;
  pairId?: string;
  displayContent?: string;
  noteMetadata?: LLMNoteMetadata;
  sourceLabel?: string;
  savedToNote?: boolean;
};

export type ChatPersistContext = {
  relatedItems: QuickChatRelatedItemRef[];
  relatedMode: QuickChatRelatedMode;
  relatedContextSignature: string;
  relatedContextIncludedCount: number;
};

export type ChatPersistThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatPersistMessage[];
  context?: ChatPersistContext;
};

export type ChatPersistItemRecord = {
  activeThreadId: string | null;
  threads: ChatPersistThread[];
};

export type ChatPersistData = {
  version: 1;
  items: Record<string, ChatPersistItemRecord>;
};

export type ChatPersistIo = {
  getDirectory(): string | null;
  ensureDirectory(dir: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  join(dir: string, name: string): string;
};

const VERSION = 1;
const MAX_THREADS_PER_ITEM = 20;
const MAX_MESSAGES_PER_THREAD = 120;
const MAX_CHARS_PER_MESSAGE = 50000;
const STORE_DIR_NAME = "ai-butler-chat";
const STORE_FILE_NAME = "threads.json";
const LEGACY_UNTITLED_TITLE = "新对话";
const WRITE_DELAY_MS = 250;

function logPersistFailure(message: string, error: unknown): void {
  if (typeof ztoolkit === "undefined") return;
  try {
    ztoolkit.log(message, error);
  } catch {
    // Logging must not break chat persistence.
  }
}

export function untitledThreadTitle(): string {
  try {
    const localized = getString("itempane-quick-chat-thread-untitled");
    if (
      localized &&
      localized !== "itempane-quick-chat-thread-untitled" &&
      !localized.endsWith("itempane-quick-chat-thread-untitled")
    ) {
      return localized;
    }
  } catch {
    // Locale is unavailable in unit tests and during early startup.
  }
  return LEGACY_UNTITLED_TITLE;
}

function isUntitledTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  return title === untitledThreadTitle() || title === LEGACY_UNTITLED_TITLE;
}

function truncateContent(content: unknown): string {
  const text = String(content ?? "");
  if (text.length <= MAX_CHARS_PER_MESSAGE) return text;
  return `${text.slice(0, MAX_CHARS_PER_MESSAGE)}\n\n[truncated]`;
}

export function normalizeChatMessages(
  messages: readonly ChatPersistMessage[] | null | undefined,
): ChatPersistMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-MAX_MESSAGES_PER_THREAD).map((message) => ({
    role:
      message?.role === "assistant"
        ? "assistant"
        : message?.role === "system"
          ? "system"
          : "user",
    content: truncateContent(message?.content),
    ...(message?.pairId ? { pairId: message.pairId } : {}),
    ...(message?.displayContent !== undefined
      ? { displayContent: truncateContent(message.displayContent) }
      : {}),
    ...(message?.noteMetadata
      ? { noteMetadata: { ...message.noteMetadata } }
      : {}),
    ...(message?.sourceLabel ? { sourceLabel: message.sourceLabel } : {}),
    ...(message?.savedToNote ? { savedToNote: true } : {}),
  }));
}

/** Older threads have no context; always return an independent, empty default. */
export function cloneChatContext(
  context?: ChatPersistContext,
): ChatPersistContext {
  return {
    relatedItems: (context?.relatedItems || []).map((ref) => ({ ...ref })),
    relatedMode: context?.relatedMode === "fullText" ? "fullText" : "summary",
    relatedContextSignature: context?.relatedContextSignature || "",
    relatedContextIncludedCount: context?.relatedContextIncludedCount || 0,
  };
}

export function titleFromMessages(
  messages: readonly ChatPersistMessage[],
): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return untitledThreadTitle();
  const compact = String(firstUser.displayContent ?? firstUser.content ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return untitledThreadTitle();
  return compact.length > 36 ? `${compact.slice(0, 36)}…` : compact;
}

function emptyData(): ChatPersistData {
  return { version: VERSION, items: {} };
}

function createZoteroChatPersistIo(): ChatPersistIo {
  const getDirectory = (): string | null => {
    const candidates: string[] = [];
    const scope = globalThis as {
      Zotero?: {
        Profile?: { dir?: string };
        DataDirectory?: { dir?: string };
      };
      Services?: {
        dirsvc?: {
          get?: (name: string, iface: unknown) => { path?: string };
        };
      };
      Components?: { interfaces?: { nsIFile?: unknown } };
      PathUtils?: { join: (...parts: string[]) => string };
    };
    try {
      const profileDir = scope.Zotero?.Profile?.dir;
      if (profileDir) candidates.push(String(profileDir));
    } catch {
      // Profile service may be unavailable in tests.
    }
    try {
      const file = scope.Services?.dirsvc?.get?.(
        "ProfD",
        scope.Components?.interfaces?.nsIFile,
      );
      if (file?.path) candidates.push(String(file.path));
    } catch {
      // ProfD is a fallback when Zotero.Profile is missing.
    }
    try {
      const dataDir = scope.Zotero?.DataDirectory?.dir;
      if (dataDir) candidates.push(String(dataDir));
    } catch {
      // Data directory is the last fallback.
    }
    const base = candidates.find((candidate) => !!candidate);
    if (!base || !scope.PathUtils) return null;
    return scope.PathUtils.join(base, STORE_DIR_NAME);
  };

  return {
    getDirectory,
    async ensureDirectory(dir: string): Promise<void> {
      await IOUtils.makeDirectory(dir, {
        createAncestors: true,
        ignoreExisting: true,
      });
    },
    async exists(path: string): Promise<boolean> {
      return IOUtils.exists(path);
    },
    async read(path: string): Promise<string> {
      return IOUtils.readUTF8(path);
    },
    async write(path: string, text: string): Promise<void> {
      await IOUtils.writeUTF8(path, text);
    },
    join(dir: string, name: string): string {
      return PathUtils.join(dir, name);
    },
  };
}

export class ChatPersist {
  private data: ChatPersistData = emptyData();
  private loaded = false;
  private loadingPromise: Promise<ChatPersistData> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly io: ChatPersistIo;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(io?: ChatPersistIo, now?: () => number, createId?: () => string) {
    this.io = io ?? createZoteroChatPersistIo();
    this.now = now ?? (() => Date.now());
    this.createId =
      createId ?? (() => `t_${this.now()}_${Math.floor(Math.random() * 1e6)}`);
  }

  async ensureLoaded(): Promise<ChatPersistData> {
    if (this.loaded) return this.data;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      try {
        const storePath = this.getStorePath();
        const dir = this.io.getDirectory();
        if (dir) {
          try {
            await this.io.ensureDirectory(dir);
          } catch {
            // Directory creation is retried on flush.
          }
        }
        if (storePath && (await this.io.exists(storePath))) {
          const raw = await this.io.read(storePath);
          const parsed = JSON.parse(raw) as Partial<ChatPersistData>;
          if (parsed && typeof parsed === "object" && parsed.items) {
            this.data = {
              version: VERSION,
              items: parsed.items || {},
            };
          }
        }
      } catch (error) {
        logPersistFailure("[AI-Butler] ChatPersist load failed:", error);
      } finally {
        this.loaded = true;
        this.loadingPromise = null;
      }
      return this.data;
    })();
    return this.loadingPromise;
  }

  private getStorePath(): string | null {
    const dir = this.io.getDirectory();
    return dir ? this.io.join(dir, STORE_FILE_NAME) : null;
  }

  private scheduleSave(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      void this.flush();
    }, WRITE_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      const dir = this.io.getDirectory();
      const storePath = this.getStorePath();
      if (!dir || !storePath) return;
      await this.io.ensureDirectory(dir);
      await this.io.write(storePath, JSON.stringify(this.data));
    } catch (error) {
      logPersistFailure("[AI-Butler] ChatPersist save failed:", error);
    }
  }

  private ensureItem(itemId: number | string): ChatPersistItemRecord {
    const key = String(itemId);
    if (!this.data.items[key]) {
      this.data.items[key] = { activeThreadId: null, threads: [] };
    }
    return this.data.items[key];
  }

  private pruneItem(record: ChatPersistItemRecord): void {
    if (!record || !Array.isArray(record.threads)) return;
    record.threads.sort(
      (left, right) => (right.updatedAt || 0) - (left.updatedAt || 0),
    );
    if (record.threads.length > MAX_THREADS_PER_ITEM) {
      record.threads = record.threads.slice(0, MAX_THREADS_PER_ITEM);
    }
    if (
      record.activeThreadId &&
      !record.threads.some((thread) => thread.id === record.activeThreadId)
    ) {
      record.activeThreadId = record.threads[0]?.id || null;
    }
  }

  listThreads(itemId: number | string): ChatPersistThread[] {
    const record = this.ensureItem(itemId);
    return (record.threads || [])
      .slice()
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  }

  getThread(
    itemId: number | string,
    threadId: string | null | undefined,
  ): ChatPersistThread | null {
    if (!threadId) return null;
    const record = this.ensureItem(itemId);
    const thread =
      (record.threads || []).find((thread) => thread.id === threadId) || null;
    // Assign stable IDs before later history trimming, including pre-fix data.
    thread?.messages.forEach((message, index) => {
      if (message.role === "assistant" && !message.pairId) {
        message.pairId = `${thread.id}_legacy_${index}`;
      }
    });
    return thread;
  }

  createThread(itemId: number | string, title?: string): ChatPersistThread {
    const record = this.ensureItem(itemId);
    const thread: ChatPersistThread = {
      id: this.createId(),
      title: title || untitledThreadTitle(),
      createdAt: this.now(),
      updatedAt: this.now(),
      messages: [],
      context: cloneChatContext(),
    };
    record.threads.unshift(thread);
    record.activeThreadId = thread.id;
    this.pruneItem(record);
    this.scheduleSave();
    return thread;
  }

  getOrCreateActiveThread(itemId: number | string): ChatPersistThread {
    const record = this.ensureItem(itemId);
    const active = record.activeThreadId
      ? this.getThread(itemId, record.activeThreadId)
      : null;
    if (active) return active;
    return this.createThread(itemId);
  }

  setActiveThread(
    itemId: number | string,
    threadId: string,
  ): ChatPersistThread | null {
    const record = this.ensureItem(itemId);
    const thread = this.getThread(itemId, threadId);
    if (!thread) return null;
    record.activeThreadId = threadId;
    this.scheduleSave();
    return thread;
  }

  private writeMessages(
    itemId: number | string,
    threadId: string | null | undefined,
    messages: ChatPersistMessage[],
    context?: ChatPersistContext,
  ): ChatPersistThread | null {
    if (itemId == null || !threadId) return null;
    const record = this.ensureItem(itemId);
    let thread = this.getThread(itemId, threadId);
    if (!thread) {
      thread = this.createThread(itemId);
    }
    thread.messages = messages;
    if (context) thread.context = context;
    thread.updatedAt = this.now();
    if (
      messages.some((message) => message.role === "user") ||
      isUntitledTitle(thread.title)
    ) {
      thread.title = titleFromMessages(messages);
    }
    record.activeThreadId = thread.id;
    this.pruneItem(record);
    this.scheduleSave();
    return thread;
  }

  saveMessages(
    itemId: number | string | null | undefined,
    threadId: string | null | undefined,
    messages: readonly ChatPersistMessage[] | null | undefined,
    context?: ChatPersistContext,
  ): ChatPersistThread | null {
    if (itemId == null || !threadId) return null;
    const snapshot = normalizeChatMessages(messages);
    const contextSnapshot = context ? cloneChatContext(context) : undefined;
    if (!this.loaded) {
      void this.ensureLoaded().then(() => {
        this.writeMessages(itemId, threadId, snapshot, contextSnapshot);
      });
      return this.getThread(itemId, threadId);
    }
    return this.writeMessages(itemId, threadId, snapshot, contextSnapshot);
  }

  markPairSaved(itemId: number, threadId: string, pairId: string): void {
    const thread = this.getThread(itemId, threadId);
    const message = thread?.messages.find(
      (message) => message.role === "assistant" && message.pairId === pairId,
    );
    if (!message) return;
    message.savedToNote = true;
    // Saving a note may finish after the user switches or deletes a thread.
    this.scheduleSave();
  }

  deleteThread(
    itemId: number | string | null | undefined,
    threadId: string | null | undefined,
  ): ChatPersistThread | null {
    if (itemId == null || !threadId) return null;
    const record = this.ensureItem(itemId);
    const threads = Array.isArray(record.threads) ? record.threads : [];
    const index = threads.findIndex((thread) => thread.id === threadId);
    if (index < 0) return this.getOrCreateActiveThread(itemId);
    threads.splice(index, 1);
    record.threads = threads;
    if (record.threads.length === 0) {
      return this.createThread(itemId, untitledThreadTitle());
    }
    if (
      record.activeThreadId === threadId ||
      !record.threads.some((thread) => thread.id === record.activeThreadId)
    ) {
      record.activeThreadId = record.threads[0].id;
    }
    this.pruneItem(record);
    this.scheduleSave();
    return (
      this.getThread(itemId, record.activeThreadId) ||
      this.getOrCreateActiveThread(itemId)
    );
  }
}

export const chatPersist = new ChatPersist();
// === END AI_BUTLER_CHAT_PERSIST_V1 ===
