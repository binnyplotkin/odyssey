/* ── Kanban Board — Types & Data ─────────────────────────────── */

export type TicketStatus = "backlog" | "todo" | "in-progress" | "review" | "done";

export type TicketDomain =
  | "research"
  | "voice"
  | "engine"
  | "data"
  | "frontend"
  | "world"
  | "infra"
  | "design";

export type TicketPriority = "P1" | "P2" | "P3";

export type Subtask = {
  id: string;
  label: string;
  done: boolean;
};

export type ActivityItem = {
  id: string;
  author: string;
  authorColor: string;
  timestamp: string;
  text: string;
  type: "comment" | "system";
};

export type Ticket = {
  id: string;
  title: string;
  description?: string;
  status: TicketStatus;
  domain?: TicketDomain;
  priority?: TicketPriority;
  assignee?: string;
  phase?: string;
  featureId?: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  subtasks?: Subtask[];
  activity?: ActivityItem[];
};

export type Column = {
  id: TicketStatus;
  label: string;
  dotColor: string;
};

/* ── Columns ─────────────────────────────────────────────────── */

export const COLUMNS: Column[] = [
  { id: "backlog", label: "Backlog", dotColor: "#64748B" },
  { id: "todo", label: "To Do", dotColor: "#3B82F6" },
  { id: "in-progress", label: "In Progress", dotColor: "#3B82F6" },
  { id: "review", label: "Review", dotColor: "#F59E0B" },
  { id: "done", label: "Done", dotColor: "#22C55E" },
];

/* ── Domain tag colors ───────────────────────────────────────── */

export const DOMAIN_COLORS: Record<TicketDomain, { color: string; bg: string }> = {
  research: { color: "#8B7EB5", bg: "rgba(139, 126, 192, 0.1)" },
  voice: { color: "#C8875A", bg: "rgba(200, 136, 90, 0.1)" },
  engine: { color: "#5B7FB5", bg: "rgba(91, 127, 181, 0.1)" },
  data: { color: "#C45C5C", bg: "rgba(196, 92, 92, 0.1)" },
  frontend: { color: "#5B7FB5", bg: "rgba(91, 127, 181, 0.1)" },
  world: { color: "#5A9E82", bg: "rgba(90, 158, 130, 0.1)" },
  infra: { color: "#8B7EB5", bg: "rgba(139, 126, 192, 0.1)" },
  design: { color: "#8B7EB5", bg: "rgba(139, 126, 192, 0.1)" },
};

/* ── Priority corner-dot colors ──────────────────────────────── */

export const PRIORITY_DOT: Record<TicketPriority, string> = {
  P1: "#EF4444",
  P2: "#F59E0B",
  P3: "#64748B",
};

/* ── Initial tickets (matching the Paper design) ─────────────── */

export const INITIAL_TICKETS: Ticket[] = [
  // ── Backlog ──
  {
    id: "ticket-1",
    title: "Research Mimi codec speaker embedding injection points",
    description:
      "Identify where speaker identity can be injected in the Mimi audio codec pipeline",
    status: "backlog",
    domain: "research",
    priority: "P2",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-15",
  },
  {
    id: "ticket-2",
    title: "ElevenLabs narrator voice selection",
    description: "Audition and select narrator voice for scene transitions",
    status: "backlog",
    domain: "voice",
    priority: "P1",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-16",
  },
  {
    id: "ticket-3",
    title: "Design state vector conditioning API",
    status: "backlog",
    domain: "engine",
    priority: "P2",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-17",
  },
  {
    id: "ticket-4",
    title: "GPU provider cost comparison",
    status: "backlog",
    domain: "infra",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-18",
  },

  // ── To Do ──
  {
    id: "ticket-5",
    title: "Curate Abraham dialogue training dataset",
    description:
      "Generate ~5K turns of Abraham-style dialogue across emotional states for LoRA training",
    status: "todo",
    domain: "data",
    priority: "P1",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-20",
    subtasks: [
      { id: "st-13", label: "Define emotional state taxonomy", done: false },
      { id: "st-14", label: "Write seed prompts for each state", done: false },
      { id: "st-15", label: "Generate 5K dialogue turns", done: false },
      { id: "st-16", label: "Quality filter and deduplicate", done: false },
    ],
  },
  {
    id: "ticket-6",
    title: "Set up PEFT/HuggingFace LoRA pipeline",
    description: "Configure training infrastructure with rank-4/rank-16 experiments",
    status: "todo",
    domain: "engine",
    priority: "P1",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-21",
  },
  {
    id: "ticket-7",
    title: "Rewrite console from REST to WebSocket",
    status: "todo",
    domain: "frontend",
    priority: "P1",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-22",
  },

  // ── In Progress ──
  {
    id: "ticket-8",
    title: "Fork Moshi repo + get inference running",
    description:
      "Clone Moshi, set up A100 environment, validate base inference quality before modifications",
    status: "in-progress",
    domain: "engine",
    priority: "P1",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-25",
    subtasks: [
      { id: "st-1", label: "Clone Moshi repository", done: true },
      { id: "st-2", label: "Provision A100 GPU instance", done: true },
      { id: "st-3", label: "Run base inference benchmark", done: false },
      { id: "st-4", label: "Document latency baselines", done: false },
    ],
    activity: [
      {
        id: "a-1",
        author: "B",
        authorColor: "#8B7EB5",
        timestamp: "3h ago",
        text: "A100 instance is up. Running initial inference tests now — voice quality sounds promising.",
        type: "comment",
      },
      {
        id: "a-2",
        author: "S",
        authorColor: "#5B7FB5",
        timestamp: "5h ago",
        text: "Status changed from To Do → In Progress",
        type: "system",
      },
    ],
  },
  {
    id: "ticket-9",
    title: "OpenAI Realtime MVP integration",
    description:
      "Connect orchestrator to OpenAI Realtime with tool calling for Abraham's Tent",
    status: "in-progress",
    domain: "engine",
    priority: "P1",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-26",
    subtasks: [
      { id: "st-5", label: "Set up Realtime API connection", done: true },
      { id: "st-6", label: "Implement tool calling bridge", done: false },
      { id: "st-7", label: "Wire up Abraham's Tent world config", done: false },
    ],
    activity: [
      {
        id: "a-3",
        author: "B",
        authorColor: "#8B7EB5",
        timestamp: "1d ago",
        text: "Realtime API connection working. Tool calling schema next.",
        type: "comment",
      },
    ],
  },

  // ── Review ──
  {
    id: "ticket-10",
    title: "Abraham's Tent world definition",
    description:
      "6 characters, 4 metrics, 6 events, entry screen with 3 onboarding paths",
    status: "review",
    domain: "world",
    priority: "P1",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-28",
    subtasks: [
      { id: "st-8", label: "Define 6 characters with backstories", done: true },
      { id: "st-9", label: "Create 4 emotional metrics", done: true },
      { id: "st-10", label: "Design 6 narrative events", done: true },
      { id: "st-11", label: "Build entry screen with 3 paths", done: true },
      { id: "st-12", label: "QA pass on world config schema", done: false },
    ],
    activity: [
      {
        id: "a-4",
        author: "B",
        authorColor: "#8B7EB5",
        timestamp: "2d ago",
        text: "All characters and events defined. Just need QA on the schema validation.",
        type: "comment",
      },
    ],
  },

  // ── Done ──
  {
    id: "ticket-11",
    title: "MVP Architecture Canvas",
    status: "done",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-01",
  },
  {
    id: "ticket-12",
    title: "Voice mapping system (ElevenLabs)",
    status: "done",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-05",
  },
  {
    id: "ticket-13",
    title: "Heuristic state reducer",
    status: "done",
    assignee: "B",
    phase: "audio-engine",
    createdAt: "2026-03-10",
  },

  // ── Phase 2: Immersive Wellness & Stories ──────────────────
  {
    id: "ticket-14",
    title: "Ambient soundscape & mood engine",
    description:
      "Build a generative audio layer that produces ambient soundscapes adapting to scene mood, tension, and character emotion",
    status: "backlog",
    domain: "engine",
    priority: "P1",
    assignee: "B",
    phase: "wellness-stories",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-15",
    title: "Guided meditation world templates",
    description:
      "Design reusable world definitions for guided meditation — breath work, body scan, visualization journeys",
    status: "backlog",
    domain: "world",
    priority: "P1",
    assignee: "B",
    phase: "wellness-stories",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-16",
    title: "Self-exploration character archetypes",
    description:
      "Create character archetype library for therapeutic contexts — inner critic, compassionate observer, wise elder, shadow self",
    status: "backlog",
    domain: "world",
    priority: "P2",
    assignee: "B",
    phase: "wellness-stories",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-17",
    title: "Branching narrative framework",
    description:
      "Extend the event system to support branching story paths with reader-driven choices and consequence tracking",
    status: "backlog",
    domain: "engine",
    priority: "P1",
    assignee: "B",
    phase: "wellness-stories",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-18",
    title: "Emotional tone tracking & adaptation",
    description:
      "Detect user emotional state from voice prosody and content, adapting world pacing and character behavior in real time",
    status: "backlog",
    domain: "engine",
    priority: "P2",
    assignee: "B",
    phase: "wellness-stories",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-19",
    title: "User-created worlds (publish & share)",
    description:
      "Build consumer-facing world creation flow with publish pipeline, sharing links, and embed support",
    status: "backlog",
    domain: "frontend",
    priority: "P2",
    assignee: "B",
    phase: "wellness-stories",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-20",
    title: "Community world discovery & ratings",
    description:
      "Build discovery feed for published worlds with search, categories, ratings, and play counts",
    status: "backlog",
    domain: "frontend",
    priority: "P3",
    assignee: "B",
    phase: "wellness-stories",
    createdAt: "2026-04-10",
  },

  // ── Phase 3: Multimedia Worlds ─────────────────────────────
  {
    id: "ticket-21",
    title: "2D scene image generation",
    description:
      "Integrate an image generation model to produce scene illustrations on the fly based on world state and narrative beats",
    status: "backlog",
    domain: "engine",
    priority: "P1",
    assignee: "B",
    phase: "multimedia",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-22",
    title: "Video clip rendering pipeline",
    description:
      "Build a pipeline that composites generated images, voice audio, and ambient sound into shareable video clips",
    status: "backlog",
    domain: "infra",
    priority: "P1",
    assignee: "B",
    phase: "multimedia",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-23",
    title: "Visual character portraits & expressions",
    description:
      "Generate and cache character portrait images with expression variants driven by emotional state",
    status: "backlog",
    domain: "engine",
    priority: "P2",
    assignee: "B",
    phase: "multimedia",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-24",
    title: "Multi-format export (audio, video, mixed)",
    description:
      "Allow users to export completed sessions as audio-only, video, or mixed-media packages",
    status: "backlog",
    domain: "frontend",
    priority: "P2",
    assignee: "B",
    phase: "multimedia",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-25",
    title: "Live video streaming for sessions",
    description:
      "Stream generated visuals in real time alongside voice audio during live simulation sessions",
    status: "backlog",
    domain: "infra",
    priority: "P1",
    assignee: "B",
    phase: "multimedia",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-26",
    title: "Creator tools for multimedia worlds",
    description:
      "Extend the world editor with visual asset management — upload reference images, set scene moods, configure visual style",
    status: "backlog",
    domain: "frontend",
    priority: "P2",
    assignee: "B",
    phase: "multimedia",
    createdAt: "2026-04-10",
  },
  {
    id: "ticket-27",
    title: "Community marketplace & monetization",
    description:
      "Build marketplace for creators to sell premium worlds with payment processing, revenue splits, and analytics",
    status: "backlog",
    domain: "frontend",
    priority: "P3",
    assignee: "B",
    phase: "multimedia",
    createdAt: "2026-04-10",
  },
];
