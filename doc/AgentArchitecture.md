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
  partially streamed arguments. Readable SSE previews update the UI, while tool
  calls remain unavailable until the terminal response and arguments validate.
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
`read_result`, `delegate_research`, `trash_items`, `start_paper_workflow`,
`get_paper_workflow_status`. `create_note` uses `AI-Agent`; standard workflows
retain their existing summary/deep-reading note classification.

`start_paper_workflow(itemId, mode, regenerate?)` is a write tool routed to
`TaskQueueManager.addTask()` / `addDeepReadTask()`. It immediately returns the
task ID and before/after state. Active tasks and complete notes are reused by
default; explicit regeneration still respects the saved note strategy and never
forces an overwrite. Prompt templates, endpoint routing, PDF settings, retries,
and incomplete deep-read recovery stay with the existing workflow.

`get_paper_workflow_status(taskId, wait?)` is read-only and returns progress,
errors, artifact readiness, and the result note ID for `read_note`. Note discovery
uses pure classifiers instead of migration-capable `AiNoteService.findNote()`.
With `wait=true`, queue completion/progress/removal events resume the tool call,
so dependent research can continue without model polling. Transient failures
that the queue will retry do not end the wait. Subscriptions and the 30-minute
timeout are disposed on completion, final failure, removal, cancellation, or
timeout. Stopping the Agent cancels waiting, not the already authorized queue
job. Restarted sessions do not automatically resume; the user can query the
persisted task in a subsequent run.

`trash_items(itemIds)` moves explicitly selected regular parent papers to Zotero
Trash using the native API inside one transaction. All targets are preflighted
for library scope and editability, with before/after evidence and existing write
approval/receipt behavior. It does not erase, merge, transfer child notes, or
empty Trash. Collection membership removal remains a separate operation.

Permission changes are accepted with the next `AgentService.run()` call, which
refreshes the system prompt and available tool catalog in the same session and
records the new authority in the activity log. Historical assistant claims do
not define the current authority or add capabilities absent from the catalog.

Citation clicks resolve personal/group library IDs and item keys locally and
call the main window's `ZoteroPane.selectItem()`, then focus that window. Only
HTTP(S) citations use `Zotero.launchURL()`; Zotero links never enter the external
protocol handler. Missing/trashed items display inline feedback. The isolated
host smoke test exercises the actual Markdown anchor click in a chrome dialog.

## Context and evidence

The conversation groups each user turn into an expandable work process and a
separate final delivery. Completed turns default to the delivery; running,
failed and interrupted work remains open. Tool cards pair arguments with results
by call/member ID, and pending approval controls stay outside the fold. The
Trajectory tab is an independent searchable ledger with input/model/tool lanes,
equal-width or duration-weighted blocks, turn/detail folding, inline approvals,
and navigation back to the conversation. Its interaction follows the local DSH
`ui-trajectory` toolbar, overview and record-detail design. Explicit assistant
phases and terminal status events preserve per-turn
outcomes; older ledgers infer the final lead response only after tool work ends.

This interaction follows the local DSH reference's `TurnProcessSpec`,
`TurnProcessNodeView` and `ReasoningRow` pattern (under
`reference/deepseek-harness/packages/client/ui-chat/src/client/`): final answers
remain separate from intermediate text, reasoning and tool disclosures.
Readable reasoning returned by providers is recorded as reasoning events;
encrypted replay data, redacted thinking and signatures are never rendered.
Agent transport streams Chat Completions, Responses, Anthropic and Gemini SSE;
gateways returning JSON still work. The same preview event becomes the complete
reply. Failed/retried/cancelled previews stay marked as interrupted work, outside
the model's message history. Signatures and encrypted state stay in the final
provider envelope. A local HTTP fixture withholds the final chunk until native
Zotero acknowledges a partial reply, verifying actual XHR progress delivery.
Existing sessions retain their recorded history; missing old
reasoning events are not fabricated from opaque replay data.

The sidebar storage disclosure shows the actual
`Zotero.DataDirectory.dir/ai-butler-agent` path and opens that folder. Each session
is a JSON snapshot containing conversation, evidence and approval history.
These files are local and are not part of Zotero sync; model requests still go
to the configured provider. Both sidebar and welcome branding use the packaged
`icons/logo.svg` asset.

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
history. Summaries use the Agent output allowance (capped at one quarter of the
context window) with low reasoning effort instead of inheriting the endpoint's
effort. If a proactive summary fails, the retained history can continue while it
fits the input budget; another summary is deferred until that budget is exceeded
or the API reports overflow. Cancellation and failed mandatory compaction still
stop the run. Failed summaries do not accumulate duplicate history archives.
API overflow receives one retry only after actual context reduction; truncated
tool calls remain invalid even when their argument JSON is parseable.

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

## Public web evidence

`AgentService` resolves the session's `webSearch` setting: unconfigured sessions
use Parallel Search MCP, and `disabled` removes both `web_search` and
`web_fetch` before the model turn. The existing endpoint, PDF policy and library
permissions still apply. The existing run-settings picker saves this choice with
the conversation. Read-only teammates receive the same enabled web tools.

`parallelSearchClient.ts` uses native `Zotero.HTTP.request` for MCP Streamable
HTTP initialization, tool discovery and execution at
`https://search.parallel.ai/mcp`. JSON and SSE responses are accepted. Requests
have a 60-second timeout, cancellation aborts XHR, and failures return to the
normal tool-error ledger without a provider fallback. Only text tool content is
returned as evidence; the runtime's existing artifact and context bounds apply.

`AgentService` creates an opaque UUID for each conversation before its first
enabled run. The durable `webSearchSessionId` is supplied outside model-selected
arguments and reused for search, fetch, follow-ups and retries. New conversations
get independent IDs; concurrent sessions never mutate the shared client's
identity. MCP connection headers remain local to each call.

The tools send model-selected public research queries and URLs to Parallel,
not an automatic copy of library notes or PDFs. Prompt instructions treat web
results as untrusted evidence and require source URLs. Disabling web search
makes no MCP requests. HTTP(S) fetch URLs with embedded credentials are rejected.
Anonymous searches use Fast mode without an API key and are subject to service
limits. Search errors do not count as evidence.
