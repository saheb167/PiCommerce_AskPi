# Ask Pi — Technical Architecture, Prompt, DSL & Components

A deep-dive into how the Ask Pi campaign-building capability works, in increasing technical detail.

---

## Part 1 — Executive Overview

Ask Pi turns a plain-English marketing brief — e.g. *"reach churned customers with WhatsApp then voice, split by LTV"* — into a validated, multi-channel campaign workflow rendered on a visual canvas. The user describes intent in chat; Ask Pi proposes a channel plan, asks only for the missing details (audience, templates, timing, branch rules), validates the result against deterministic compliance checks, and saves a draft.

There are **two** distinct front-ends that share **one** engine:

1. **AskPiConversation** — a deterministic, form-driven wizard (no LLM). A finite state machine walks the user through intent → brief → resolve → validate → confirm. Predictable, testable, always available.
2. **CopilotChat agent** — a true LLM conversation (CopilotKit 1.61 + Anthropic `claude-sonnet-4-5`). Natural language in, tool-calls out. The model never invents data or decides validation; it only orchestrates a fixed set of registered "actions".

Both front-ends call the SAME shared core in `src/lib/tenant-registry.ts`:

- `analyzeBrief()` — parse English into a `BriefConfig`
- `channelOpenVars()` — compute the "open variables" the user must resolve
- builders — turn a config into ReactFlow nodes/edges
- `runChecks()` — deterministic validation (block > warn > pass)

This shared core is the single source of truth. The two UIs are just different ways of filling in the same blanks.

**Key design principle: THE MODEL ORCHESTRATES, THE CODE DECIDES.** The LLM chooses which action to call and in what order, but every plan shape, every open variable, and every pass/warn/block verdict is computed by deterministic TypeScript. The model cannot fabricate a template id, a segment, or a "valid" verdict.

---

## Part 2 — System Architecture & the Request Round-Trip

**Stack:** TanStack Start (React 19) + Vite + Tailwind 4 + Radix/shadcn UI + ReactFlow 11 for the canvas. The agent layer uses CopilotKit 1.61 with an Anthropic adapter.

### 2.1 The agent provider is scoped, not global

The CopilotKit provider only wraps NEW campaign routes (`campaigns.$id.tsx:134-135`). Ask Pi is not a global assistant — it exists for the act of authoring a campaign.

### 2.2 The chat round-trip

```
CopilotChat UI (AiComposer.tsx:328)
  --> POST /api/copilotkit (COPILOT_ENDPOINT, endpoint.ts:5)
  --> server.ts:75-77 routes to handleCopilotRequest() (runtime.server.ts:311-321)
  --> withSystemPrompt() middleware (runtime.server.ts:276-304)
  --> CopilotRuntime + AnthropicAdapter (buildRuntime, runtime.server.ts:141-163)
  --> Anthropic claude-sonnet-4-5 (default; override via PI_AGENT_MODEL env)
  --> tool-calls stream back as "actions" -> React renders cards on the canvas
```

### 2.3 API key resolution & offline fallback

Key resolution order (`runtime.server.ts:65-76`): `env.ANTHROPIC_API_KEY` → `process.env.ANTHROPIC_API_KEY` → `OfflinePiAgent` fallback. The baseURL is pinned to `https://api.anthropic.com/v1` (`runtime.server.ts:158`). If no key is present, an offline deterministic agent answers so the UI never hard-fails.

### 2.4 Middleware hardening

`withSystemPrompt()` does more than inject the prompt. It also:

- `dedupeToolCalls()` (191-204) — drop duplicate tool invocations
- `repairOrphanToolCalls()` (229-255) — heal tool-call/result mismatches that otherwise crash the Anthropic message format

This makes the multi-turn loop robust against CopilotKit's streaming quirks.

---

## Part 3 — The Prompt Layer

### 3.1 Where the prompt actually lives

The EFFECTIVE prompt is `PI_SYSTEM_PROMPT` (`runtime.server.ts:45-61`). Crucially, it is NOT sent as a system-role message. It is INJECTED INTO the latest user message, wrapped in delimiters:

```
PI_PROMPT_MARKER  = "[[pi-style]]"
PI_PROMPT_END     = "[[/pi-style]]"   (endpoint.ts:15-16)
```

and then stripped client-side before display via `PiUserMessage` / `stripPiPrompt` (`AiComposer.tsx:108-111`).

**Why inject into the user turn?** CopilotKit 1.61's AG-UI BuiltInAgent only weakly honors injected system messages (`runtime.server.ts:269-272`). Putting the steering text inside the user turn guarantees the model sees it on every turn.

### 3.2 The dead twin

`AGENT_INSTRUCTIONS` (`AiComposer.tsx:14-30`) is BYTE-IDENTICAL to `PI_SYSTEM_PROMPT` but is DEAD at runtime — CopilotKit does not forward the `instructions` prop to the model. It is kept in sync purely as living documentation next to the UI. **RULE: any prompt edit must be applied byte-identically to BOTH files.**

### 3.3 What the prompt enforces (the 16 bullets)

`PI_SYSTEM_PROMPT` is 16 bullets covering identity, terse style (replies ≤ 14 words), banned generic openers, first-line restatement of intent, and the core campaign-building protocol:

- **START WITH TEMPLATE CARD**, but with a carry-forward EXCEPTION: if the user already gave a full brief, skip the template card and build straight away.
- **SHOW CARD ONCE PER SESSION** — never spam the template chooser.
- **PATH A** (templates) vs **PATH B** (briefs) — see Part 6.
- **RESOLVE IN PRIORITY ORDER** — the 3-tier ordering (see 3.4).
- **CONDITIONAL BRANCH** handling — per-arm templates/timing/dispositions.
- **TYPED RESOLVE LOOP** — the user can resolve by typing; `applyAnswers` binds it.
- **GUARD PREMATURE ACTIONS** — don't validate/confirm before the plan is ready.
- **DETERMINISTIC VALIDATION** — never decide pass/warn/block yourself.
- **NEVER INVENT IDS** — only use ids returned by `list*` actions.

### 3.4 The 3-tier resolve priority

When asking the user to fill blanks, Ask Pi orders questions by dependency:

| Tier | Name | Contents |
|------|------|----------|
| 1 | SHAPE | channels + placement (what runs, in what order) |
| 2 | CONTENT | segment, phone field, WhatsApp template, voice agent |
| 3 | LOGIC | branch rule, inter-channel delays, dispositions, A/B split % |

On the Resolve card this renders as the step order: **Audience → arms/channels → Timing & follow-up → Sending rules.**

This ordering is enforced both by the prompt AND by how `channelOpenVars` emits variables (Part 7), so the deterministic wizard and the LLM agent ask in the same sequence.

---

## Part 4 — The Agent Action Layer

The model cannot touch React state directly. It can only call ~16 registered actions (`useCopilotAction`) defined in `useCampaignAgentActions.tsx`. Each action is a typed function with a rendered "card". State lives in refs so it survives streaming re-renders: `dslRef`, `briefTextRef`, `cfgRef`, `briefPlanRef`, `briefResolvedRef`, `briefGapsRef`, `briefAssumptionsRef`, `briefNameRef`, `templateCardShownRef`.

The 16 actions, grouped:

**Discovery** (read-only, return seed registry data so the model never guesses):
`listCampaignTemplates`, `listSegments`, `listWhatsAppTemplates`, `listVoiceAgents`

**Template path (Path A):**
`instantiateCampaignTemplate`, `resolveCampaign`, `validateCampaign`, `confirmCampaign`

**Brief path (Path B):**
`planCampaignFromBrief`, `setChannelPlacement`, `setConditionalBranch`, `resolveBriefCampaign`, `validateBriefCampaign`, `confirmBriefCampaign`

**Shared:**
`applyAnswers` (bind typed free-text answers to open vars), `setCampaignChannels`

Supporting helpers (not actions): `annotatePlacement` (113-122) rebuilds the canvas for the conditional path; `assumptionsFor` (175-224) summarizes the current choices; `placementVarsFor` (125-130).

Cards rendered on the canvas overlay: `ResolveCard` (1146-1277), `ValidationCard` (1055-1140), `ConfirmCard` (1393-1491), `ChannelsCard` (1531-1642), `ChannelPlacementCard` (1651-1825), `ConditionalCard` (1844-1993), `BriefConfirmCard` (1997-2098).

---

## Part 5 — The Deterministic Wizard (AskPiConversation)

The no-LLM path is a finite state machine. `ConversationPhase` cycles through:

```
intent -> briefConfirm -> planning -> resolve -> journey -> splitResolve
       -> validating -> blocked -> confirm -> saved
```

Key internals:

- **resolveSteps useMemo** (442-452): partitions the open vars into wizard steps by their `group` field, ordered by first appearance. This is what produces Audience / arm / Timing & follow-up / Sending rules pages.
- **ResolveField** (1185-1259): renders the right input per var kind (Select for template/agent/segment/choice; Input for duration/threshold/percent).
- **liveChecks** (430-437): runs `runChecks()` continuously so the user sees pass/warn/block update as they fill fields.
- **onBuild / onSkeleton** callbacks: push nodes/edges to the ReactFlow canvas.

Because this path and the agent path BOTH consume `channelOpenVars` + `runChecks`, they can never disagree about what is required or what is valid.

---

## Part 6 — The Two Campaign Paths

### 6.1 PATH A — Templates (formal DSL, `src/lib/campaign/`)

A picked template is a `CampaignDSL` object validated by zod (`campaign-dsl.ts:105-121`): `version`, `name`, `objective`, `source`, `tenant`, `audience`, `flow`, `channels`, `steps`, `assumptions`.

Pipeline:

```
instantiateTemplate (registry.ts:146-172) -> CampaignDSL
  -> compile(dsl) (compiler.ts:152-174) -> AskPiPlan (nodes + edges)
  -> stored in dslRef
```

`compile()` builds stable-id nodes via `startNode` / `audienceNode` / `whatsappNode` / `voiceNode` / `delayNode` / `endNode` (`compiler.ts:47-105`). `deriveNeedsInput` (112-130) computes which fields are still unresolved; `applyResolved` (186-206) folds user answers back into the DSL. `FieldOrigin` (`campaign-dsl.ts:26-27`) tags each field as `default` / `inferred` / `must-confirm` / `resolved` so the UI knows what to ask.

`validation.ts` (58 lines) is a thin adapter: it projects the DSL into a flat `resolved` record and calls the same `validateResolved`/`runChecks` core.

### 6.2 PATH B — Briefs (English → BriefConfig)

This is the longer, more interesting path. Free text is parsed by `analyzeBrief` (`tenant-registry.ts:1214-1337`) into a `BriefConfig`, then turned into a plan by the builders. Stored across the brief refs. Detailed in Parts 7-9.

Both paths converge on `runChecks` + the Resolve card + the ReactFlow canvas.

---

## Part 7 — The Brief DSL & Analysis Engine (tenant-registry.ts)

### 7.1 Core types

```
Channel = "whatsapp" | "voice"   (line 483)

BriefConfig (492-507):
  channels, primary, fallback, fallbackWait, unavailable?, experiment?,
  conditional?, branchMatchSeq?, branchElseSeq?, channelsNamed?

TemplateVar union (100-112) — the "open variable" model. Kinds:
  segment, waTemplate, voiceAgent, phoneField, smsSender, duration,
  splitAttribute, threshold, splitValue, percent, window, choice
  Base shape: { key, label, required?, group? }
```

`CHANNEL_META` (509-515), `CHANNEL_NODE_ID { whatsapp:"wa", voice:"voice" }` (628).

`CHANNEL_DISPOSITIONS` (528-531):
- whatsapp: `[Sent, Delivered, Read, Replied, Failed]`
- voice: `[Answered, No answer, Busy, Failed]`

Seed registries (so the model never invents data): `SEGMENTS` (39-45), `WA_TEMPLATES` (47-52), `VOICE_AGENTS` (61-65), `PHONE_ATTRIBUTES` (75-80), `SPLIT_ATTRIBUTES` (128-136).

### 7.2 analyzeBrief — English to config

`analyzeBrief` (1214-1337) uses regex + keyword detection to determine:

- which channels are mentioned, and flags unsupported ones
- A/B experiment detection (1230)
- CONDITIONAL detection (1232-1295): high/low tier language, "split by `<attribute>`", explicit conditional keywords
- per-arm channel SEQUENCES (1264-1295 via `seqFromClause`): e.g. "WhatsApp for high-LTV, WhatsApp then voice for low-LTV" → `branchMatchSeq=[whatsapp]`, `branchElseSeq=[whatsapp, voice]`
- fallback logic (1306-1319); default to whatsapp if nothing else found.

---

## Part 8 — Canvas Builders, Arm Steps & Node-Scoped Keys

### 8.1 The three builders

- `buildFromChannels` (596-625) — linear / primary+fallback (with delay node)
- `buildParallelChannels` (770-799) — channels fire in parallel
- `buildConditionalChannels` (819-942) — the branch path (the hard one)

`channelNode` (546-568) builds one channel node. When given a node id it reads its resource NODE-SCOPED first (`resolved["waTemplate@"+id] ?? resolved.waTemplate`), which is what lets each arm carry its OWN template/agent.

### 8.2 The conditional branch

`buildConditionalChannels` draws a branch node (854-862) with match/else outputs, then a `buildArm` helper (873-925) lays out each arm. Between consecutive channels in an arm it inserts a delay node (id `${prefix}_delay_${i}`). For a WhatsApp node that has a successor, it attaches disposition outputs (898-906) and wires ONE edge per disposition: the chosen follow-up disposition routes to the next node, every other disposition routes to End.

`armNodeSerials` (680-697) numbers duplicate channels so the UI shows "WhatsApp 1" / "WhatsApp 2" instead of two identical labels.

### 8.3 conditionalArmSteps — the single source of truth

`conditionalArmSteps(cfg)` (732-762) flattens both arms into an ordered list of `ArmStep` records (713-723), each carrying: `arm`, `armLabel` ("Match arm"/"Else arm"), `idx`, `ch`, `nodeId`, `serialLabel`, `nextCh?`, `nextNodeId?`, `nextSerialLabel?`.

This ONE function is reused by the builder, by `channelOpenVars`, and by `runChecks` so they can never drift in how arms are numbered or ordered.

### 8.4 Node-scoped key convention

For the conditional path, variables are keyed `<base>@<nodeId>`:

```
waTemplate@m_wa        — Match-arm WhatsApp template
waTemplate@e_wa        — Else-arm WhatsApp template
voiceAgent@e_voice     — Else-arm voice agent
armDelay@e_wa>e_voice  — wait between Else-arm WhatsApp and voice
followUpOn@e_wa        — which disposition triggers the voice follow-up
```

Non-conditional builders use the plain global key (e.g. `"waTemplate"`), so their behavior is unchanged.

### 8.5 Multi-output handles on the canvas

`nodes.tsx` (199-226): if a node has `data.outputs[]`, it renders one labeled source Handle (id = `o.id`, `Position.Right`) per output. Edges set `sourceHandle:o.id` to route each disposition to its target. This is the visual realization of the disposition follow-up logic.

---

## Part 9 — Open Variables & the Resolve Card

### 9.1 channelOpenVars — computing the blanks

`channelOpenVars` (945-996) returns the `TemplateVar`s the user must resolve.

For the CONDITIONAL path it is a TWO-PASS walk over `conditionalArmSteps(cfg)`:

- **Pass 1 (Tier-2 content):** per `ArmStep` emit the resource var — key `${resourceKey}@${nodeId}`, group = `step.armLabel`, label `${serialLabel} · ${noun}`
- **Pass 2 (Tier-3 logic),** grouped "Timing & follow-up":
  - `armDelay@${nodeId}>${nextNodeId}` (label `${armLabel} · Wait before ${next}`)
  - `followUpOn@${nodeId}` (kind "choice", options `CHANNEL_DISPOSITIONS.whatsapp`, default "Failed")

For the NON-conditional path (985-995) it emits the plain deduped resource vars, with `fallbackWindow` grouped under "Timing & follow-up".

`timingVars` (209-215) adds `sendWindow`, `frequencyCap`, `startTiming` under "Sending rules".

### 9.2 resolveFromText & typed resolution

`resolveFromText` (392-467) has a per-kind matcher so the user can resolve by typing in chat (e.g. *"voice agent Reactivation Voice, wait 3 hours, follow up when WhatsApp Failed"*). `applyAnswers` binds these strings to the matching open vars across both UIs.

### 9.3 The group field drives stepper layout only

`TemplateVar.group` is used solely to partition the Resolve stepper by first appearance. It is NOT read by `runChecks` or `assumptionsFor` (which key off var key/kind and `conditionalArmSteps`). So regrouping a var is SAFE — it changes the question ORDER, not the validation.

---

## Part 10 — Deterministic Validation & Compliance

`runChecks` (1541-1734) is the compliance brain. It produces `ValidationCheck`s at `reportLevel` block / warn / pass (1519-1532), and the overall verdict is block > warn > pass. The LLM never decides this.

Checks include:

- segment resolved; phone field resolved
- per-channel resource resolved (template/agent), iterating the actual resource vars present so the conditional path validates EACH arm node
- WhatsApp opt-in + landline sub-checks per matched template
- fallback / inter-channel wait present (one check per duration var, covering each per-gap `armDelay@*`)
- disposition follow-up reported ("Voice follows up when WhatsApp = Failed")
- channel sequence sanity
- A/B split percentages sum correctly
- audience split attribute resolved
- conditional branch rule resolved
- sending window within quiet hours (`windowWithinQuietHours`, 9am-9pm) via `parseSendWindow` (318-348)
- frequency cap

`assumptionsFor` (175-224) summarizes the current per-arm templates, waits, and follow-up dispositions back to the user (read from the node-scoped resolved keys in `briefResolvedRef`, ordered by `conditionalArmSteps`).

---

## Part 11 — Data Model Reference (campaign-types.ts)

```
NodeKind          — start | audience | whatsapp | voice | delay | branch | end ...
WorkflowNodeData  — label, kind, group, outputs?, config? (drives nodes.tsx)
PresetConfig      — paths/config carried by a node
NodeOutput        — { id, label, kind } where kind = branch | variant | exit | default
CampaignStatus    — draft / ... lifecycle
```

Drafts are SESSION-SCOPED via React refs (no localStorage). "Saved as draft v1" fires through `cb.onSavedDraft`. There is no real backend persistence in this MVP — the registries are seed data and the draft lives in memory for the session.

---

## Part 12 — Design Principles & Gotchas

1. **MODEL ORCHESTRATES, CODE DECIDES.** Every shape, blank, and verdict is deterministic TypeScript. The LLM only sequences tool-calls.
2. **ONE ENGINE, TWO UIS.** The wizard and the agent share `channelOpenVars`, builders, and `runChecks`. They cannot disagree.
3. **SINGLE SOURCE OF TRUTH FOR ARMS.** `conditionalArmSteps()` is reused by builder + open-vars + validator — change arm ordering in one place only.
4. **NODE-SCOPED KEYS** unlock per-arm differentiation (`<base>@<nodeId>`), while non-conditional paths keep simple global keys.
5. **PROMPT TWINS MUST STAY BYTE-IDENTICAL.** `PI_SYSTEM_PROMPT` (effective) and `AGENT_INSTRUCTIONS` (documentation) — edit both or neither.
6. **THE PROMPT RIDES THE USER TURN,** not the system role, because CopilotKit 1.61 underweights injected system messages.
7. **NEVER INVENT IDS.** The model must call `list*` actions and use only returned ids; `runChecks` will block anything unresolved.
8. **group IS COSMETIC.** It orders the Resolve stepper, nothing else.

---

## Appendix — Key File Map

**Agent runtime / prompt:**
- `src/lib/copilot/runtime.server.ts` — `PI_SYSTEM_PROMPT` (45-61), `buildRuntime` (141-163), `withSystemPrompt` (276-304), `handleCopilotRequest` (311-321)
- `src/lib/copilot/endpoint.ts` — `COPILOT_ENDPOINT`, prompt delimiters
- `src/components/workflow/AiComposer.tsx` — CopilotChat UI (328), `AGENT_INSTRUCTIONS` (14-30, dead twin), `stripPiPrompt` (108-111)

**Brief engine (the core):**
- `src/lib/tenant-registry.ts` — `BriefConfig` (492-507), `TemplateVar` (100-112), `analyzeBrief` (1214-1337), builders (596-942), `conditionalArmSteps` (732-762), `channelOpenVars` (945-996), `resolveFromText` (392-467), `runChecks` (1541-1734)

**Template DSL path:**
- `src/lib/campaign/campaign-dsl.ts` — zod `CampaignDSL` (105-121)
- `src/lib/campaign/compiler.ts` — `compile` (152-174), node builders (47-105)
- `src/lib/campaign/validation.ts` — DSL → resolved adapter
- `src/lib/campaign/registry.ts` — `instantiateTemplate` (146-172)

**UI & canvas:**
- `src/components/workflow/AskPiConversation.tsx` — deterministic wizard
- `src/components/workflow/useCampaignAgentActions.tsx` — 16 agent actions + cards
- `src/components/workflow/nodes.tsx` — multi-output handles (199-226)
- `src/components/workflow/WorkflowCanvas.tsx` — ReactFlow host
- `src/lib/campaign-types.ts` — `NodeKind`, `NodeOutput`, etc.
