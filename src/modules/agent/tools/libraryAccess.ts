import { getString } from "../../../utils/locale";
import type { AgentTool, AgentToolContext } from "./types";
import { exactKeys } from "./validation";

export function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  execute: AgentTool["execute"],
  write = false,
): AgentTool {
  return {
    definition: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
    write,
    async execute(args, context) {
      exactKeys(args, Object.keys(properties));
      context.assertActive();
      if (write) assertWritable(context);
      const result = await execute(args, context);
      // A completed write must still return its audit result if cancellation
      // arrived while Zotero was committing it.
      if (!write) context.assertActive();
      return result;
    },
  };
}

export function assertWritable(context: AgentToolContext): void {
  context.assertActive();
  if (context.session.permission === "read-only")
    throw new Error(getString("agent-tool-error-read-only"));
  if (!Zotero.Libraries.isEditable(context.session.options.libraryID))
    throw new Error(getString("agent-tool-error-library-read-only"));
}

export function assertObjectScope(
  object: Zotero.Item | Zotero.Collection,
  context: AgentToolContext,
): void {
  context.assertActive();
  if (
    object.deleted ||
    object.libraryID !== context.session.options.libraryID
  ) {
    throw new Error(getString("agent-tool-error-target-unavailable"));
  }
}

export async function scopedItem(
  id: number,
  context: AgentToolContext,
): Promise<Zotero.Item> {
  const item = await Zotero.Items.getAsync(id);
  context.assertActive();
  if (
    !item ||
    item.deleted ||
    item.libraryID !== context.session.options.libraryID
  ) {
    throw new Error(getString("agent-tool-error-item-unavailable"));
  }
  return item;
}

export function source(item: Zotero.Item) {
  const libraryURI = String(Zotero.URI.getLibraryURI(item.libraryID));
  const groupId = /\/groups\/(\d+)/.exec(libraryURI)?.[1];
  return {
    itemId: item.id,
    libraryID: item.libraryID,
    key: item.key,
    uri: `zotero://select/${groupId ? `groups/${groupId}` : "library"}/items/${item.key}`,
  };
}
