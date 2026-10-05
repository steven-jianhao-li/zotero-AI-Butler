# Agent runtime and maintenance

The Agent workspace extends the existing Zotero plugin without adding a second
provider configuration system or an external runtime. Business-level requests
cross `LLMService`: `agentTurn()` for native tool loops and
`generateWithEndpoint()` for isolated paper reading.

## Boundaries

```text
views/agent/             Session workspace, safe Markdown, approvals, activity
agent/AgentService.ts   Session lifecycle, user authority, cancellation, write queue
agent/AgentRunner.ts    Model/tool loop, planning, bounded research teammates
agent/context.ts       Token estimates, balanced history, compaction projection
agent/AgentStore.ts     Atomic versioned session snapshots in Zotero data directory
agent/permissions.ts    Executor permission and JSON-schema argument checks
agent/tools/           Scoped Zotero reads and auditable organization operations
llmService.ts          Existing endpoint routing, options, retries and PDF policy
llmproviders/          Native wire formats and provider continuation state
```

The UI does not execute tools. The model cannot set permission, endpoint, PDF mode
or library scope. User-selected options become the run configuration. Automatic
routing selects a coordinator once per run; a separate reader can be selected.

## Loop invariants

- Validate complete model responses before exposing tool calls. Never execute
  partially streamed arguments. Current Agent turns use non-streaming responses;
  activity and completed messages update progressively in the UI.
- Keep assistant calls and tool results paired by ID. On cancellation/restart,
  synthesize interrupted results for unfinished calls before another model turn.
- Carry opaque provider continuation state with its assistant turn. This includes
  signed thinking/Response reasoning/Gemini signatures; never render it as prose.
- Validate arguments at the executor and at the Zotero boundary. Read-only tools
  cannot normalize/migrate notes as a hidden side effect.
- Serialize library writes across sessions, and recheck cancellation, library
  scope and editability at execution time. Persist a pending mutation receipt
  before execution and its result afterward. A pending receipt is an uncertain
  outcome after a crash; neither it nor a completed receipt is replayed.
- Bind approval to one validated argument object. Denial suppresses identical
  requests for the remainder of the run. Reopening a stored session grants no
  write authority or reusable approval.

Tools: `search_library`, `get_item`, `read_note`, `list_collections`, `read_paper`,
`edit_tags`, `create_collection`, `organize_items`, `create_note`, `update_plan`,
`read_result`, `delegate_research`. Agent notes use `AI-Agent`, preserving existing
summary/deep-reading classification.

## Context and evidence

The session's activity and evidence ledger is distinct from `messages`, the
working model projection. Tool results receive recoverable `resultRef` identifiers.
Large results are paged; metadata and note previews precede full note/original
reading. Stable citation references contain the library ID, item key and Zotero
selection URI. Source text is untrusted evidence, never additional authority.

The budget includes system messages, tool schemas and an output reservation.
Estimates account conservatively for non-ASCII text and are calibrated upward
when API input usage exceeds the estimate. Compaction first prunes older tool
results with recoverable references, then archives and summarizes complete older
exchanges. Recent calls remain paired. Summarizer input is bounded by the selected
context window; empty, incomplete or non-shrinking summaries do not replace the
history. API overflow receives one retry only after actual context reduction.

Default limits: 262144 context tokens, 8192 output tokens, 32 lead steps, 10 steps
per teammate, six teammates per run, three per delegation batch, 128 shared tool
calls. Repeated identical calls are bounded. Evidence storage has a 24-million
character per-session guard; new writes reserve room for their audit results.

`read_paper` asks a separate LLM invocation to inspect the original paper. The
existing content-policy resolver prepares native PDF/Base64 or text/MinerU input.
The main loop receives a bounded evidence report, provider/model metadata and
source references. No binary PDF enters its working context or persisted ledger.
`persistExtractedContent: false` is request scoped and reaches MinerU regardless
of save preferences; cancellation reaches OCR HTTP and polling. Zotero native
download/indexing calls already in progress are not forcibly interruptible.

Teammates receive a fresh task-specific context, shared recoverable evidence and
read-only tools; they cannot delegate or change the parent's plan. This is bounded
research delegation, not a persistent general-purpose process/message network.

## Validation

```bash
npm run test:agent
npm run build
npm run lint:check
```

The Node test runner bundles production code and injects fixture boundaries. Tests
cover native protocol mapping, opaque state, malformed/truncated calls, permission
and approval checks, crash receipts, cancellation pairing, compaction budgets,
transaction audits, scoped note reading, no-write OCR and extraction cancellation.
These fixtures do not replace integration testing inside Zotero/Gecko.

For opt-in real API tests, set `AGENT_TEST_API_URL`, `AGENT_TEST_API_KEY` and
`AGENT_TEST_MODEL` in the process environment, then run `npm run test:agent:live`.
Optionally set `AGENT_TEST_PDF_MODEL` and `AGENT_TEST_PDF_PROVIDER` (default
`openai-compat`) to test native Base64 paper reading through the real service.
`-- --pdf-only` isolates the PDF scenario; `-- --compact-only` tests actual model
compaction and evidence retention. Keys are never included in source or reports.
The test supplies an in-memory Zotero library and a generated PDF with a random
verification code; it never opens the user's actual library.

The initial live validation used `qwen3.8-flash-next-uncensored-bf16` for native
tools, note discovery, two parallel teammates and final citations, and
`gpt-6-luna` for a Base64 PDF specialist. This verifies those endpoint/model
combinations; it does not establish compatibility with every stronger model or
all other native provider transports.

The live compaction scenario also passed on the Qwen endpoint: a 16K working
window triggered one summary, recovered the original evidence code and numeric
result, and retained the original history archive. The three scenarios made 20
API requests in total and performed zero library mutations. UI validation used
the actual view/CSS code with host stubs in Chromium (desktop, narrow, dark mode,
approvals, safe Markdown and citation clicks); native Gecko-host behavior still
requires verification in Zotero.

## Reference designs

Designs were inspected at these local reference revisions; no runtime dependency
or copied application framework was introduced:

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc): balanced loop history, compaction envelope, interruption and bounded teams.
- [dsh-desktop](https://github.com/dataelement/dsh-desktop/tree/beb6821af66d5980b2526ecb63b2df29badf4a1f): session sidebar, centered conversation/composer and secondary activity panel.
- [beaver-zotero](https://github.com/jlegewie/beaver-zotero/tree/b87cf998d6e326c6fa82a5eb5af4af57ef23cc43): paginated note disclosure, library scoping and audited write boundaries.
