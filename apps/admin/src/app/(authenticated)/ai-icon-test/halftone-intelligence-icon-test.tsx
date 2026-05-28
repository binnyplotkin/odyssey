"use client";

import { useRef, useState, type ReactNode } from "react";
import { AgentComposer } from "@/components/admin-agent-sidebar/agent-composer";
import { AgentHeader } from "@/components/admin-agent-sidebar/agent-header";
import { AgentThread } from "@/components/admin-agent-sidebar/agent-thread";
import type {
  ChatMessage,
  Operation,
  ToolCard,
} from "@/components/admin-agent-sidebar/types";
import {
  HalftoneIntelligenceIcon,
  type HalftoneIntelligenceState,
} from "@/components/halftone-intelligence-icon";

const states: Array<{ value: HalftoneIntelligenceState; label: string }> = [
  { value: "idle", label: "Idle" },
  { value: "listening", label: "Listening" },
  { value: "thinking", label: "Thinking" },
  { value: "processing", label: "Processing" },
  { value: "responding", label: "Responding" },
];

const densities = ["compact", "standard", "detailed"] as const;

export function HalftoneIntelligenceIconTest() {
  const [state, setState] = useState<HalftoneIntelligenceState>("thinking");
  const [size, setSize] = useState(260);
  const [intensity, setIntensity] = useState(1);
  const [speedScale, setSpeedScale] = useState(1);
  const [density, setDensity] =
    useState<(typeof densities)[number]>("detailed");

  return (
    <main className="ai-icon-lab">
      <section className="ai-icon-lab-header">
        <div>
          <div className="ai-icon-lab-kicker">UI Lab</div>
          <h1>AI intelligence icon</h1>
        </div>
        <div className="ai-icon-lab-meta">/ai-icon-test</div>
      </section>

      <section className="ai-icon-lab-grid">
        <div className="ai-icon-lab-stage">
          <HalftoneIntelligenceIcon
            state={state}
            size={size}
            intensity={intensity}
            speedScale={speedScale}
            density={density}
          />
        </div>

        <aside className="ai-icon-lab-controls" aria-label="AI icon controls">
          <SegmentedControl
            label="State"
            value={state}
            options={states}
            onChange={setState}
          />

          <RangeControl
            label="Size"
            value={size}
            min={80}
            max={420}
            step={10}
            suffix="px"
            onChange={setSize}
          />
          <RangeControl
            label="Intensity"
            value={intensity}
            min={0.35}
            max={1.35}
            step={0.05}
            suffix=""
            onChange={setIntensity}
          />
          <RangeControl
            label="Speed"
            value={speedScale}
            min={0.55}
            max={1.8}
            step={0.05}
            suffix="x"
            onChange={setSpeedScale}
          />

          <div className="ai-icon-lab-control">
            <div className="ai-icon-lab-control-label">Density</div>
            <div className="ai-icon-lab-density">
              {densities.map((option) => (
                <button
                  key={option}
                  type="button"
                  data-active={density === option}
                  onClick={() => setDensity(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section
        className="ai-icon-lab-variants"
        aria-label="AI icon state variants"
      >
        {states.map((item) => (
          <Preview key={item.value} title={item.label}>
            <HalftoneIntelligenceIcon
              state={item.value}
              size={116}
              intensity={intensity}
              speedScale={speedScale}
              density="standard"
            />
          </Preview>
        ))}
      </section>

      <section className="ai-icon-lab-sizes" aria-label="AI icon size variants">
        <Preview title="Nav">
          <HalftoneIntelligenceIcon state={state} size={28} density="compact" />
        </Preview>
        <Preview title="Button">
          <button type="button" className="ai-icon-lab-command">
            <HalftoneIntelligenceIcon
              state={state}
              size={22}
              density="compact"
            />
            <span>AI</span>
          </button>
        </Preview>
        <Preview title="Panel">
          <HalftoneIntelligenceIcon
            state={state}
            size={72}
            density="standard"
          />
        </Preview>
        <Preview title="Hero">
          <HalftoneIntelligenceIcon
            state={state}
            size={148}
            intensity={intensity}
            speedScale={speedScale}
          />
        </Preview>
      </section>

      <AiSidebarPreview />

      <style>{`
        .ai-icon-lab {
          min-height: 100%;
          padding: 28px;
          color: var(--foreground);
          background: var(--background);
        }

        .ai-icon-lab-header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 20px;
          max-width: 1180px;
          margin: 0 auto 24px;
        }

        .ai-icon-lab-kicker,
        .ai-icon-lab-meta,
        .ai-icon-lab-control-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 650;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }

        .ai-icon-lab h1 {
          margin: 6px 0 0;
          font-size: 32px;
          line-height: 1.1;
          letter-spacing: 0;
        }

        .ai-icon-lab-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 330px;
          gap: 18px;
          max-width: 1180px;
          margin: 0 auto;
          align-items: stretch;
        }

        .ai-icon-lab-stage {
          min-height: 500px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-1);
          overflow: hidden;
        }

        .ai-icon-lab-controls {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 18px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-1);
        }

        .ai-icon-lab-control {
          display: grid;
          gap: 9px;
        }

        .ai-icon-lab-control-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .ai-icon-lab-value {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px;
          color: var(--foreground);
          font-variant-numeric: tabular-nums;
        }

        .ai-icon-lab input[type="range"] {
          width: 100%;
          accent-color: var(--accent);
        }

        .ai-icon-lab-segments,
        .ai-icon-lab-density {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .ai-icon-lab-density {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .ai-icon-lab-segments button,
        .ai-icon-lab-density button {
          min-height: 34px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--control-bg);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }

        .ai-icon-lab-segments button[data-active="true"],
        .ai-icon-lab-density button[data-active="true"] {
          border-color: var(--border-active);
          background: var(--accent-soft);
          color: var(--accent-strong);
        }

        .ai-icon-lab-variants,
        .ai-icon-lab-sizes {
          max-width: 1180px;
          margin: 18px auto 0;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 18px;
        }

        .ai-icon-lab-sizes {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .ai-sidebar-preview {
          max-width: 1180px;
          margin: 18px auto 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 420px;
          gap: 18px;
          align-items: stretch;
        }

        .ai-sidebar-preview-copy {
          min-height: 560px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 18px;
          padding: 18px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-1);
        }

        .ai-sidebar-preview-copy h2 {
          margin: 8px 0 10px;
          font-size: 24px;
          line-height: 1.15;
          letter-spacing: 0;
        }

        .ai-sidebar-preview-copy p {
          margin: 0;
          max-width: 620px;
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.55;
        }

        .ai-sidebar-preview-list {
          display: grid;
          gap: 8px;
          margin: 18px 0 0;
          padding: 0;
          list-style: none;
        }

        .ai-sidebar-preview-list li {
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--control-bg);
          color: var(--text-secondary);
          font-size: 13px;
        }

        .ai-sidebar-scenarios {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-top: 18px;
        }

        .ai-sidebar-scenarios button {
          min-height: 34px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--control-bg);
          color: var(--text-secondary);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 650;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
        }

        .ai-sidebar-scenarios button[data-active="true"] {
          border-color: var(--accent-border);
          background: var(--accent-soft);
          color: var(--accent-strong);
        }

        .ai-sidebar-scenario-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 18px;
        }

        .ai-sidebar-scenario-meta span {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 2px 8px;
          border: 1px solid var(--border);
          border-radius: var(--radius-pill);
          background: var(--ink-wash);
          color: var(--text-tertiary);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .ai-sidebar-preview-rail {
          height: 640px;
          min-height: 0;
          overflow: hidden;
          border: 1px solid var(--ink-fill);
          border-radius: 8px;
          background: var(--sidebar);
        }

        .ai-sidebar-preview-rail > div {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .ai-icon-lab-preview {
          min-height: 180px;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 12px;
          padding: 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-1);
        }

        .ai-icon-lab-preview-title {
          color: var(--text-tertiary);
          font-size: 12px;
          font-weight: 650;
        }

        .ai-icon-lab-preview-body {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ai-icon-lab-command {
          min-width: 92px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid var(--border-active);
          border-radius: 8px;
          background: var(--accent-soft);
          color: var(--accent-strong);
          font-weight: 700;
        }

        @media (max-width: 1080px) {
          .ai-icon-lab-grid,
          .ai-icon-lab-variants,
          .ai-icon-lab-sizes,
          .ai-sidebar-preview {
            grid-template-columns: minmax(0, 1fr);
          }

          .ai-icon-lab-stage {
            min-height: 380px;
          }
        }

        @media (max-width: 560px) {
          .ai-icon-lab {
            padding: 18px;
          }

          .ai-icon-lab-header {
            align-items: start;
            flex-direction: column;
          }

          .ai-icon-lab h1 {
            font-size: 26px;
          }

          .ai-icon-lab-segments {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
    </main>
  );
}

type SidebarScenarioKey =
  | "empty"
  | "thinking"
  | "tool"
  | "approval"
  | "approving"
  | "rejected"
  | "error"
  | "complete";

type SidebarScenario = {
  key: SidebarScenarioKey;
  label: string;
  description: string;
  route: string;
  streaming: boolean;
  approvingId: string | null;
  cancellingId: string | null;
  messages: ChatMessage[];
  toolCards: ToolCard[];
  operations: Operation[];
};

const pendingOperation: Operation = {
  id: "op_001",
  toolName: "propose_entity_patch",
  intent: "Clarify the character summary and mark the prompt review as needed.",
  riskLevel: "medium",
  status: "pending",
  affectedRecords: [{ table: "characters", label: "abraham" }],
  previewDiff: {
    rationale: "Improves admin clarity without changing runtime behavior.",
    patch: {
      summary: "More specific character positioning for admin review.",
      needsPromptReview: true,
    },
    before: {
      summary: "Abraham character.",
      needsPromptReview: false,
    },
  },
  resultSummary: null,
};

const sidebarScenarios: SidebarScenario[] = [
  {
    key: "empty",
    label: "Empty",
    description: "Initial ready state before the admin asks anything.",
    route: "/characters/abraham",
    streaming: false,
    approvingId: null,
    cancellingId: null,
    messages: [],
    toolCards: [],
    operations: [],
  },
  {
    key: "thinking",
    label: "Thinking",
    description: "Assistant response has started but no text has streamed yet.",
    route: "/characters/abraham",
    streaming: true,
    approvingId: null,
    cancellingId: null,
    messages: [
      {
        id: "thinking-user",
        role: "user",
        content: "Audit this character page and tell me what needs attention.",
      },
      { id: "thinking-agent", role: "assistant", content: "" },
    ],
    toolCards: [],
    operations: [],
  },
  {
    key: "tool",
    label: "Tool Run",
    description: "Read tools are running and results are starting to arrive.",
    route: "/wikis/genesis/ingestion",
    streaming: true,
    approvingId: null,
    cancellingId: null,
    messages: [
      {
        id: "tool-user",
        role: "user",
        content: "Check ingestion health and recent wiki activity.",
      },
      {
        id: "tool-agent",
        role: "assistant",
        content: "I am reading the current wiki context and recent runs.",
      },
    ],
    toolCards: [
      {
        id: "tool-1",
        toolName: "inspect_route_context",
        status: "completed",
        detail: "Read current page context, params, and related admin records.",
      },
      {
        id: "tool-2",
        toolName: "analyze_wiki_ingestion",
        status: "running",
        detail: "Checking latest runs, source volume, and failure rate.",
      },
    ],
    operations: [],
  },
  {
    key: "approval",
    label: "Approval",
    description: "Mutation has been prepared and is waiting for confirmation.",
    route: "/characters/abraham",
    streaming: true,
    approvingId: null,
    cancellingId: null,
    messages: [
      {
        id: "approval-user",
        role: "user",
        content: "Make the safest metadata cleanup you recommend.",
      },
      {
        id: "approval-agent",
        role: "assistant",
        content:
          "I prepared a conservative metadata patch. Review the affected fields before execution.",
      },
    ],
    toolCards: [
      {
        id: "approval-tool-1",
        toolName: "inspect_character_config",
        status: "completed",
        detail:
          "Checked identity, voice, model, knowledge bindings, and prompt flags.",
      },
      {
        id: "approval-tool-2",
        toolName: "propose_entity_patch",
        status: "completed",
        detail:
          "Generated an approval preview without writing to the database.",
      },
    ],
    operations: [pendingOperation],
  },
  {
    key: "approving",
    label: "Approving",
    description: "Approval was clicked and the write request is in flight.",
    route: "/characters/abraham",
    streaming: true,
    approvingId: "op_001",
    cancellingId: null,
    messages: [
      {
        id: "approving-user",
        role: "user",
        content: "Apply the safe metadata cleanup.",
      },
      {
        id: "approving-agent",
        role: "assistant",
        content: "Executing the approved operation now.",
      },
    ],
    toolCards: [
      {
        id: "approving-tool",
        toolName: "execute_approved_operation",
        status: "running",
        detail: "Writing approved patch to the database.",
      },
    ],
    operations: [pendingOperation],
  },
  {
    key: "rejected",
    label: "Rejected",
    description: "Operation was declined and no database write was executed.",
    route: "/characters/abraham",
    streaming: false,
    approvingId: null,
    cancellingId: null,
    messages: [
      {
        id: "rejected-user",
        role: "user",
        content: "Reject that suggested metadata patch.",
      },
      {
        id: "rejected-system",
        role: "system",
        content: "Operation op_004 cancelled.",
      },
    ],
    toolCards: [],
    operations: [
      {
        ...pendingOperation,
        id: "op_004",
        status: "cancelled",
      },
    ],
  },
  {
    key: "error",
    label: "Error",
    description: "Failure state for a tool or operation with a visible reason.",
    route: "/voices",
    streaming: false,
    approvingId: null,
    cancellingId: null,
    messages: [
      {
        id: "error-user",
        role: "user",
        content: "Update the selected voice provider settings.",
      },
      {
        id: "error-agent",
        role: "assistant",
        content:
          "The requested change could not be staged because the voice record is missing provider configuration.",
      },
      {
        id: "error-system",
        role: "system",
        content: "Operation op_002 failed before execution.",
      },
    ],
    toolCards: [
      {
        id: "error-tool",
        toolName: "inspect_voice_record",
        status: "failed",
        detail: "Provider config was not present on the selected voice.",
      },
    ],
    operations: [
      {
        ...pendingOperation,
        id: "op_002",
        toolName: "propose_voice_patch",
        intent: "Update voice provider configuration.",
        riskLevel: "high",
        status: "failed",
        affectedRecords: [{ table: "voices", label: "abraham-weathered" }],
        errorMessage: "Missing providerConfig for this voice record.",
      },
    ],
  },
  {
    key: "complete",
    label: "Complete",
    description: "Executed operation and final assistant summary.",
    route: "/characters/abraham",
    streaming: false,
    approvingId: null,
    cancellingId: null,
    messages: [
      {
        id: "complete-user",
        role: "user",
        content: "Apply the approved metadata cleanup.",
      },
      {
        id: "complete-agent",
        role: "assistant",
        content:
          "Done. The character metadata was updated and the prompt review flag is now visible for the next pass.",
      },
      {
        id: "complete-system",
        role: "system",
        content: "Operation op_003 executed.",
      },
    ],
    toolCards: [
      {
        id: "complete-tool",
        toolName: "execute_approved_operation",
        status: "completed",
        detail: "Database write completed and the route can be refreshed.",
      },
    ],
    operations: [
      {
        ...pendingOperation,
        id: "op_003",
        status: "executed",
        resultSummary: {
          updated: 1,
          table: "characters",
        },
      },
    ],
  },
];

function AiSidebarPreview() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scenarioKey, setScenarioKey] =
    useState<SidebarScenarioKey>("approval");
  const [draft, setDraft] = useState("");
  const scenario =
    sidebarScenarios.find((item) => item.key === scenarioKey) ??
    sidebarScenarios[0];
  const pendingCount = scenario.operations.filter(
    (operation) => operation.status === "pending",
  ).length;

  return (
    <section className="ai-sidebar-preview" aria-label="AI sidebar preview">
      <div className="ai-sidebar-preview-copy">
        <div>
          <div className="ai-icon-lab-kicker">AI sidebar components</div>
          <h2>Operational rail preview</h2>
          <p>
            This fixture renders the same header, thread, tool cards, operation
            approval card, and composer used by the live admin agent.
          </p>
          <ul className="ai-sidebar-preview-list">
            <li>Header uses the global halftone intelligence mark.</li>
            <li>Messages separate user, agent, and system state.</li>
            <li>Tool and operation cards use semantic admin status tokens.</li>
            <li>Composer includes quick prompts and guarded submit styling.</li>
          </ul>
          <div className="ai-sidebar-scenarios" aria-label="Sidebar scenarios">
            {sidebarScenarios.map((item) => (
              <button
                key={item.key}
                type="button"
                data-active={scenario.key === item.key}
                onClick={() => {
                  setScenarioKey(item.key);
                  setDraft("");
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="ai-sidebar-scenario-meta">
            <span>{scenario.route}</span>
            <span>{scenario.streaming ? "streaming" : "settled"}</span>
            <span>{scenario.description}</span>
          </div>
        </div>
      </div>

      <div className="ai-sidebar-preview-rail">
        <div>
          <AgentHeader
            pathname={scenario.route}
            pendingCount={pendingCount}
            operationCount={scenario.operations.length}
            streaming={scenario.streaming}
            onClose={() => undefined}
          />
          <AgentThread
            scrollRef={scrollRef}
            messages={scenario.messages}
            toolCards={scenario.toolCards}
            operations={scenario.operations}
            approvingId={scenario.approvingId}
            cancellingId={scenario.cancellingId}
            streaming={scenario.streaming}
            onApprove={() => undefined}
            onCancel={() => undefined}
            onUsePrompt={setDraft}
          />
          <AgentComposer
            draft={draft}
            streaming={false}
            onDraftChange={setDraft}
            onSubmit={() => undefined}
          />
        </div>
      </div>
    </section>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="ai-icon-lab-control">
      <div className="ai-icon-lab-control-label">{label}</div>
      <div className="ai-icon-lab-segments">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-active={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ai-icon-lab-control">
      <span className="ai-icon-lab-control-row">
        <span className="ai-icon-lab-control-label">{label}</span>
        <span className="ai-icon-lab-value">
          {formatControlValue(value, step)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function formatControlValue(value: number, step: number) {
  if (step >= 1) return value.toFixed(0);
  return value.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

function Preview({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ai-icon-lab-preview">
      <div className="ai-icon-lab-preview-title">{title}</div>
      <div className="ai-icon-lab-preview-body">{children}</div>
    </div>
  );
}
