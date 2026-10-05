import { agentText } from "./messages";
import { closePendingToolCalls } from "./context";
import type { AgentSession } from "./types";

const SESSION_ID = /^session-[a-z0-9]+-[a-z0-9]+$/;

/** Session files are local-only, independent of preferences and task queue data. */
export class AgentStore {
  private writes = new Map<string, Promise<void>>();

  private directory(): string {
    return PathUtils.join(Zotero.DataDirectory.dir, "ai-butler-agent");
  }

  private path(id: string): string {
    if (!SESSION_ID.test(id))
      throw new Error(agentText("agent-runtime-invalid-session-id"));
    return PathUtils.join(this.directory(), `${id}.json`);
  }

  async load(): Promise<AgentSession[]> {
    const directory = this.directory();
    if (!(await IOUtils.exists(directory))) return [];
    const sessions: AgentSession[] = [];
    for (const path of await IOUtils.getChildren(directory)) {
      const name = PathUtils.filename(path);
      if (!name.endsWith(".json") || !SESSION_ID.test(name.slice(0, -5)))
        continue;
      try {
        const raw = JSON.parse(await IOUtils.readUTF8(path)) as {
          version?: number;
          session?: AgentSession;
        };
        const session = raw.session;
        if (
          raw.version !== 1 ||
          !session ||
          session.id !== name.slice(0, -5) ||
          !Array.isArray(session.messages) ||
          !Array.isArray(session.events) ||
          !session.options ||
          !session.context
        )
          throw new Error(agentText("agent-runtime-invalid-session-format"));
        closePendingToolCalls(
          session.messages,
          "Previous run was interrupted.",
        );
        session.pendingApprovals = [];
        // Permission is an active user choice, never restored from disk.
        session.permission = "read-only";
        session.options.permission = "read-only";
        session.artifacts ||= {};
        session.plan ||= [];
        session.team ||= [];
        for (const member of session.team) {
          if (member.status === "running") member.status = "cancelled";
        }
        if (
          session.status === "running" ||
          session.status === "waiting-approval"
        )
          session.status = "cancelled";
        sessions.push(session);
      } catch (error) {
        ztoolkit.log("[AI-Butler Agent] Cannot load session", name, error);
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  save(session: AgentSession): Promise<void> {
    const path = this.path(session.id);
    const snapshot = JSON.stringify({ version: 1, session });
    const previous = this.writes.get(session.id) || Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        await IOUtils.makeDirectory(this.directory(), { ignoreExisting: true });
        await IOUtils.writeUTF8(path, snapshot, { tmpPath: `${path}.tmp` });
      });
    this.writes.set(session.id, write);
    return write;
  }

  async remove(id: string): Promise<void> {
    await this.writes.get(id)?.catch(() => undefined);
    await IOUtils.remove(this.path(id), { ignoreAbsent: true });
    this.writes.delete(id);
  }
}
