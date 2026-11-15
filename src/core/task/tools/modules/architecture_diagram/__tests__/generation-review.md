# Architecture-board generation acceptance scenarios

These are manual model/viewer acceptance scenarios, not automated tests. The skill integration tests protect instruction delivery; phrase assertions cannot establish diagram quality. Run these in fresh foreground conversations with the updated skill. Inspect both the saved semantic graph and the rendered board. Record diagram name/version, source revision or working-tree scope, and any rendering limitation. Do not count successful publication as visual verification.

## 1. Understand runtime ownership

Prompt: “Whiteboard how synchronous subagents work inside a task. Exclude Goals.”

Expected:
- No diagram-type questionnaire. Starts with a small overview of one batch, per-worker invocation scope, and the main path.
- Parent awaits the batch; workers run concurrently. Shared workspace is visible, not presented as isolated processes/worktrees.
- Ownership comes from current source. If shown, `SubagentRunner` owns `SubagentAbortHandler`; the usage publisher is local to the orchestration invocation alongside the runner, not runner-owned or an autonomous service.
- Audit/accounting detail does not replace ownership boundaries with topic buckets.

Follow-up: “Explain cancellation in depth.”

Expected: a focused detail board identified as a detail of the overview; preserves the overview rather than inflating it with every implementation helper. Verify deadline/status claims against current source.

Reader check, without opening every inspector: Who owns the abort helper? Who owns the usage publisher? Does the parent keep reasoning while workers run? What resources can workers conflict over?

## 2. Design and refine

Prompt: “Design a background indexing service for this application. It must support cancellation and incremental updates without blocking foreground work.”

Expected:
- Inspects relevant current boundaries and recommends one coherent proposal, rather than presenting a menu of diagram types or three unsolicited architectures.
- Visibly distinguishes current and proposed elements. No invented code references for unimplemented symbols.
- Summarizes assumptions, consequential unresolved decisions and tradeoffs; asks only questions that materially change the design.

Follow-up: “Keep the indexer in-process for now, but make cancellation ownership explicit.”

Expected: a new version of the same named proposal; unchanged entity IDs remain stable, the new constraint is retained, and ownership changes are visible. Approval of a diagram is not treated as source-edit permission.

## 3. Compare a proposal

Prompt: “Show current versus your proposed indexer architecture.”

Expected:
- Same scope and abstraction on both sides, enough unchanged context to understand impact, and stable IDs for unchanged entities/relationships.
- Titles identify Current and Proposed; summaries identify source evidence and assumptions.
- Added/modified elements marked on the proposed side; removed elements on the baseline side. Removed objects are absent from the after topology.
- Exact published versions compared under one name. No claim of automatic semantic diffing or synchronized node positions.

## 4. Compare an implemented change

Choose a small real code change and provide an explicit base commit and after commit or working-tree scope.

Prompt: “Compare the architecture at <base commit> with <after commit or working tree>, focusing on <changed subsystem>.”

Expected:
- Inspects both sources read-only without changing checkout or overwriting working files.
- Titles/summaries identify the actual baseline and after state, with resolved commit identities where available and relevant uncommitted/untracked scope.
- Does not substitute an arbitrary earlier board for the code baseline or show changed files as if they were the architecture.
- Labels ownership, responsibility and behavioral changes, not layout movement. Notes that code links navigate current workspace files rather than immutable historical source.

Follow-up with an ambiguous baseline: “Now compare it with before.”

Expected: uses the established baseline if unambiguous; otherwise asks one targeted question instead of silently assuming HEAD.

## Acceptance rule

A board fails if the visible structure teaches false ownership, isolation, implementation status or baseline identity—even if all source links resolve and the JSON validates. A purely textual explanation of that error is not a correction: publish a semantic revision. Treat poor auto-layout separately from missing or incorrect graph relationships.
