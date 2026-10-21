import type { LLMAgentStreamUpdate } from "../agentTypes";
import { AgentProtocolError } from "./agentErrors";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Assemble native SSE responses. Only finish() exposes a complete tool envelope. */
export class AgentStreamParser {
  private buffer = "";
  private lines: string[] = [];
  private eventType = "";
  private text = "";
  private reasoning = "";
  private terminal = false;
  private done = false;
  private finishReason = "";
  private usage: ObjectValue = {};
  private response?: ObjectValue;
  private calls = new Map<
    number,
    { id: string; type: string; function: { name: string; arguments: string } }
  >();
  private blocks = new Map<number, ObjectValue>();
  private inputs = new Map<number, string>();
  private closedBlocks = new Set<number>();
  private parts: ObjectValue[] = [];

  constructor(
    private protocol: "chat" | "responses" | "anthropic" | "google",
    private update?: (value: LLMAgentStreamUpdate) => void,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) this.flush();
      else if (line.startsWith("data:"))
        this.lines.push(line.slice(5).replace(/^ /, ""));
      else if (line.startsWith("event:")) this.eventType = line.slice(6).trim();
    }
  }

  private flush(): void {
    const raw = this.lines.join("\n");
    const eventType = this.eventType;
    this.lines = [];
    this.eventType = "";
    if (!raw) return;
    if (raw === "[DONE]") {
      this.done = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AgentProtocolError("invalid-json");
    }
    const event = object(parsed);
    if (!Object.keys(event).length)
      throw new AgentProtocolError("invalid-object");
    if (!event.type && eventType) event.type = eventType;
    if (
      event.error ||
      ["error", "response.failed", "response.incomplete"].includes(
        string(event.type),
      )
    )
      throw new AgentProtocolError("truncated-turn");
    const beforeText = this.text,
      beforeReasoning = this.reasoning;
    if (this.protocol === "chat") this.chat(event);
    else if (this.protocol === "responses") {
      if (event.type === "response.output_text.delta")
        this.text += string(event.delta);
      if (event.type === "response.reasoning_summary_text.delta")
        this.reasoning += string(event.delta);
      if (event.type === "response.completed") {
        this.response = object(event.response);
        this.terminal = true;
      }
    } else if (this.protocol === "anthropic") this.anthropic(event);
    else this.google(event);
    if (beforeText !== this.text || beforeReasoning !== this.reasoning)
      this.update?.({ text: this.text, reasoningContent: this.reasoning });
  }

  private index(value: unknown): number {
    if (
      !Number.isSafeInteger(value) ||
      Number(value) < 0 ||
      Number(value) > 1024
    )
      throw new AgentProtocolError("malformed-calls");
    return Number(value);
  }

  private chat(event: ObjectValue): void {
    if (event.usage) this.usage = object(event.usage);
    if (!Array.isArray(event.choices) || event.choices.length > 1)
      throw new AgentProtocolError("invalid-choice-count");
    if (!event.choices.length) return; // Usage-only tail.
    const choice = object(event.choices[0]);
    if (choice.index !== undefined && choice.index !== 0)
      throw new AgentProtocolError("invalid-choice-count");
    const delta = object(choice.delta);
    if (delta.role && delta.role !== "assistant")
      throw new AgentProtocolError("invalid-role");
    this.text += string(delta.content);
    this.reasoning += string(delta.reasoning_content ?? delta.reasoning);
    if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls))
      throw new AgentProtocolError("malformed-calls");
    for (const value of Array.isArray(delta.tool_calls)
      ? delta.tool_calls
      : []) {
      const part = object(value),
        index = this.index(part.index),
        fn = object(part.function);
      let call = this.calls.get(index);
      if (!call) {
        call = {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        this.calls.set(index, call);
      }
      if (part.id) {
        if (call.id && call.id !== part.id)
          throw new AgentProtocolError("malformed-calls");
        call.id = string(part.id);
      }
      if (part.type) call.type = string(part.type);
      call.function.name += string(fn.name);
      call.function.arguments += string(fn.arguments);
    }
    if (choice.finish_reason) {
      if (this.finishReason && this.finishReason !== choice.finish_reason)
        throw new AgentProtocolError("truncated-turn");
      this.finishReason = string(choice.finish_reason);
      this.terminal = true;
    }
  }

  private anthropic(event: ObjectValue): void {
    if (event.type === "message_start")
      this.usage = { ...object(object(event.message).usage) };
    else if (event.type === "content_block_start") {
      const index = this.index(event.index),
        block = { ...object(event.content_block) };
      if (this.blocks.has(index))
        throw new AgentProtocolError("malformed-calls");
      this.blocks.set(index, block);
      if (block.type === "text") this.text += string(block.text);
      if (block.type === "thinking") this.reasoning += string(block.thinking);
    } else if (event.type === "content_block_delta") {
      const index = this.index(event.index),
        block = this.blocks.get(index),
        delta = object(event.delta);
      if (!block || this.closedBlocks.has(index))
        throw new AgentProtocolError("malformed-calls");
      if (delta.type === "text_delta") {
        block.text = string(block.text) + string(delta.text);
        this.text += string(delta.text);
      } else if (delta.type === "thinking_delta") {
        block.thinking = string(block.thinking) + string(delta.thinking);
        this.reasoning += string(delta.thinking);
      } else if (delta.type === "signature_delta")
        block.signature = string(block.signature) + string(delta.signature);
      else if (delta.type === "input_json_delta")
        this.inputs.set(
          index,
          (this.inputs.get(index) || "") + string(delta.partial_json),
        );
    } else if (event.type === "content_block_stop")
      this.closedBlocks.add(this.index(event.index));
    else if (event.type === "message_delta") {
      this.finishReason = string(object(event.delta).stop_reason);
      this.usage = { ...this.usage, ...object(event.usage) };
    } else if (event.type === "message_stop") this.terminal = true;
  }

  private google(event: ObjectValue): void {
    if (event.usageMetadata) this.usage = object(event.usageMetadata);
    if (!Array.isArray(event.candidates) || event.candidates.length !== 1)
      throw new AgentProtocolError("invalid-candidate-count");
    const candidate = object(event.candidates[0]);
    if (candidate.index !== undefined && candidate.index !== 0)
      throw new AgentProtocolError("invalid-candidate-count");
    const parts = object(candidate.content).parts;
    for (const value of Array.isArray(parts) ? parts : []) {
      const part = object(value);
      this.parts.push(part);
      if (part.thought === true) this.reasoning += string(part.text);
      else this.text += string(part.text);
    }
    if (candidate.finishReason) {
      if (this.finishReason && this.finishReason !== candidate.finishReason)
        throw new AgentProtocolError("truncated-turn");
      this.finishReason = string(candidate.finishReason);
      this.terminal = true;
    }
  }

  finish(): unknown {
    // An incomplete SSE frame is not a valid completion, even when its JSON looks usable.
    if (this.buffer.trim() || this.lines.length || !this.terminal)
      throw new AgentProtocolError("truncated-turn");
    if (this.protocol === "responses") return this.response;
    if (this.protocol === "chat") {
      if (!this.done) throw new AgentProtocolError("truncated-turn");
      return {
        choices: [
          {
            finish_reason: this.finishReason,
            message: {
              role: "assistant",
              content: this.text,
              reasoning_content: this.reasoning,
              tool_calls: [...this.calls]
                .sort(([a], [b]) => a - b)
                .map(([, call]) => call),
            },
          },
        ],
        usage: this.usage,
      };
    }
    if (this.protocol === "anthropic") {
      for (const [index, block] of this.blocks) {
        if (!this.closedBlocks.has(index))
          throw new AgentProtocolError("truncated-turn");
        if (this.inputs.has(index)) {
          try {
            block.input = JSON.parse(this.inputs.get(index)!);
          } catch {
            throw new AgentProtocolError("invalid-arguments");
          }
        }
      }
      return {
        content: [...this.blocks]
          .sort(([a], [b]) => a - b)
          .map(([, block]) => block),
        stop_reason: this.finishReason,
        usage: this.usage,
      };
    }
    return {
      candidates: [
        { content: { parts: this.parts }, finishReason: this.finishReason },
      ],
      usageMetadata: this.usage,
    };
  }
}
