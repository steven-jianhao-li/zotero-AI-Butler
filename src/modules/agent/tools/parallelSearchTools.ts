import { ParallelSearchClient } from "../parallelSearchClient";
import { agentToolDescriptions } from "../prompts";
import { agentText } from "../messages";
import type { AgentSession } from "../types";
import type { AgentTool } from "./types";

const client = new ParallelSearchClient();
const queries = {
  type: "array",
  minItems: 1,
  maxItems: 5,
  items: { type: "string", minLength: 1, maxLength: 300 },
};

/** Select only the built-in provider explicitly allowed by this session. */
export function createParallelSearchTools(session: AgentSession): AgentTool[] {
  if (session.options.webSearch === "disabled") return [];
  return [
    {
      definition: {
        name: "web_search",
        description: agentToolDescriptions.webSearch,
        parameters: {
          type: "object",
          properties: {
            objective: { type: "string", minLength: 1, maxLength: 2000 },
            search_queries: queries,
          },
          required: ["objective", "search_queries"],
          additionalProperties: false,
        },
      },
      write: false,
      execute: (args, context) => {
        context.assertActive();
        return client.call(
          "web_search",
          { ...args, session_id: context.session.webSearchSessionId },
          context.signal,
        );
      },
    },
    {
      definition: {
        name: "web_fetch",
        description: agentToolDescriptions.webFetch,
        parameters: {
          type: "object",
          properties: {
            urls: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: { type: "string", minLength: 1, maxLength: 4000 },
            },
            objective: { type: "string", maxLength: 200 },
            search_queries: queries,
          },
          required: ["urls"],
          additionalProperties: false,
        },
      },
      write: false,
      execute: (args, context) => {
        context.assertActive();
        for (const raw of args.urls as string[]) {
          const url = new URL(raw);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            throw new Error(agentText("agent-web-invalid-url"));
        }
        return client.call(
          "web_fetch",
          { ...args, session_id: context.session.webSearchSessionId },
          context.signal,
        );
      },
    },
  ];
}
