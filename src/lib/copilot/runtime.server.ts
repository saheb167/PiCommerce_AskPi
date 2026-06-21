/**
 * Server-only CopilotKit runtime — the bridge between the Ask Pi chat panel and
 * Claude.
 *
 * This module is intentionally imported *lazily* (only when a request hits
 * {@link COPILOT_ENDPOINT}) so the heavy CopilotKit + Anthropic graph never loads
 * on the normal SSR page-render path.
 *
 * Backend selection (CopilotKit 1.61 is AG-UI–agent based, so the runtime must
 * expose a `default` agent for the React client's `useAgent({agentId:"default"})`):
 *  - If an Anthropic API key is present (Cloudflare `env.ANTHROPIC_API_KEY` in
 *    production, `process.env.ANTHROPIC_API_KEY` in node dev) we hand the runtime
 *    an {@link AnthropicAdapter}; the runtime auto-builds a `default` BuiltInAgent
 *    from the adapter's language model.
 *  - Otherwise we register a deterministic {@link OfflinePiAgent} as the `default`
 *    agent (paired with {@link EmptyAdapter}) so the chat round-trip is fully
 *    exercisable without any secret.
 */
import "reflect-metadata";

import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicAdapter,
  CopilotRuntime,
  EmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  type CopilotServiceAdapter,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";

import { COPILOT_ENDPOINT } from "./endpoint";

/** Default model when no override is supplied. Overridable via `PI_AGENT_MODEL`. */
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

type RuntimeEnv = Record<string, unknown> | undefined;

function readEnvString(env: RuntimeEnv, key: string): string | undefined {
  const fromCloudflare = env?.[key];
  if (typeof fromCloudflare === "string" && fromCloudflare.length > 0) {
    return fromCloudflare;
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromNode = proc?.env?.[key];
  if (typeof fromNode === "string" && fromNode.length > 0) {
    return fromNode;
  }
  return undefined;
}

/** Last human turn from an AG-UI run input, if any. */
function lastUserText(input: RunAgentInput): string | undefined {
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const m = input.messages[i] as { role?: string; content?: unknown };
    if (m.role === "user" && typeof m.content === "string" && m.content.length > 0) {
      return m.content;
    }
  }
  return undefined;
}

/**
 * Deterministic, key-free AG-UI agent. Emits a single canned assistant reply that
 * echoes the user's last message so the panel ⇄ runtime ⇄ agent loop is provably
 * working before any live model is wired up.
 *
 * CopilotKit 1.61's React client resolves chat through `useAgent({agentId:"default"})`,
 * so this is registered as the runtime's `default` agent (not a serviceAdapter —
 * custom `process()` is no longer invoked for chat in 1.61).
 */
class OfflinePiAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    const lastText = lastUserText(input);
    const reply = lastText
      ? `Pi (offline mode) heard: “${lastText}”. Set ANTHROPIC_API_KEY to switch on the live assistant.`
      : "Pi is online in offline mode. Set ANTHROPIC_API_KEY to enable the live assistant.";
    const messageId = crypto.randomUUID();

    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as BaseEvent);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: reply,
      } as BaseEvent);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }
}

/**
 * Build a fresh runtime + serviceAdapter pair for a request. When a key is present
 * the AnthropicAdapter supplies model info and the runtime auto-builds a `default`
 * BuiltInAgent; otherwise we register the offline echo agent explicitly.
 */
function buildRuntime(env: RuntimeEnv): {
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
} {
  const apiKey = readEnvString(env, "ANTHROPIC_API_KEY");
  if (!apiKey) {
    return {
      runtime: new CopilotRuntime({ agents: { default: new OfflinePiAgent() } }),
      serviceAdapter: new EmptyAdapter(),
    };
  }
  const model = readEnvString(env, "PI_AGENT_MODEL") ?? DEFAULT_MODEL;
  return {
    runtime: new CopilotRuntime(),
    serviceAdapter: new AnthropicAdapter({ anthropic: new Anthropic({ apiKey }), model }),
  };
}

/**
 * Handle a request to {@link COPILOT_ENDPOINT}. Constructs a fresh runtime per
 * request (cheap; keeps the Worker stateless) and delegates to CopilotKit's
 * Web-standard App Router handler.
 */
export async function handleCopilotRequest(request: Request, env?: RuntimeEnv): Promise<Response> {
  const { runtime, serviceAdapter } = buildRuntime(env);

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: COPILOT_ENDPOINT,
  });

  return handleRequest(request);
}
