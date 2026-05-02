// ─── Interview ────────────────────────────────────────────────────────────────

export type InterviewPhase =
  | "intro"          // 1-2 turns: background, target role
  | "topic-select"   // 1 turn: pick the experience to talk about
  | "deep-dive"      // 4-6 turns: STAR excavation
  | "closing"        // 1 turn: anything to add?
  | "done";          // interview complete, ready to synthesize

export type InterviewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

// ─── Story Cards ──────────────────────────────────────────────────────────────

export type StoryStatus = "draft" | "confirmed" | "needs-info";

export type StoryCard = {
  id: string;
  title: string;
  context: string;     // Situation
  role: string;        // Task
  actions: string[];   // Action bullets
  result: string;      // Result
  skills: string[];
  followUps: string[]; // what to ask next
  status: StoryStatus;
  sourceQuote: string;
  createdAt: string;
};

// ─── Job Description ──────────────────────────────────────────────────────────

export type JobRequirement = {
  id: string;
  label: string;
  category: "hard-skill" | "soft-skill" | "domain" | "experience" | "responsibility";
  priority: "must" | "should" | "nice";
};

export type JobAnalysis = {
  id: string;
  title: string;
  company: string;
  rawText: string;
  summary: string;
  keywords: string[];
  requirements: JobRequirement[];
  updatedAt: string;
};

// ─── Resume ───────────────────────────────────────────────────────────────────

export type ResumeExperience = {
  id: string;
  title: string;
  organization: string;
  period: string;
  bullets: string[];
  skills: string[];
};

export type ResumeData = {
  name: string;
  headline: string;
  location: string;
  email: string;
  phone: string;
  links: string[];
  summary: string;
  skills: string[];
  experiences: ResumeExperience[];
  education: string[];
  notes: string[];
  targetRole: string;
  updatedAt: string;
};

// ─── App State ────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 2 as const;

export type AppState = {
  schemaVersion: typeof SCHEMA_VERSION;
  // Step 1 – JD (optional)
  jd: string | null;
  jobAnalysis: JobAnalysis | null;
  // Step 2 – Interview
  messages: InterviewMessage[];
  phase: InterviewPhase;
  turnCount: number;
  // Step 3 – Results
  stories: StoryCard[];
  resume: ResumeData | null;
};

// ─── API contracts ────────────────────────────────────────────────────────────

export type InterviewRequest = {
  action: "interview";
  messages: { role: "user" | "assistant"; content: string }[];
  jd: string | null;
  phase: InterviewPhase;
  turnCount: number;
};

export type InterviewApiResponse = {
  action: "interview";
  message: string;
  phase: InterviewPhase;
  usedAI: boolean;
};

export type SynthesizeRequest = {
  action: "synthesize";
  messages: { role: "user" | "assistant"; content: string }[];
  jd: string | null;
};

export type SynthesizeResponse = {
  action: "synthesize";
  stories: StoryCard[];
  message: string;
  usedAI: boolean;
};

export type GenerateResumeRequest = {
  action: "generate-resume";
  stories: StoryCard[];
  jd: string | null;
  baseResume?: Partial<ResumeData>;
};

export type GenerateResumeResponse = {
  action: "generate-resume";
  resume: ResumeData;
  message: string;
  usedAI: boolean;
};

// Keep backward-compat types for existing engine utilities
export type CoachAction = "analyze-jd" | "extract-story" | "next-question" | "generate-resume";
export type ChatRole = "assistant" | "user" | "system";
export type ChatMessage = { id: string; role: ChatRole; content: string; createdAt: string };
