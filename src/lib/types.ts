export type SkillCoverageStatus = "covered" | "weak" | "missing";
export type StoryStatus = "draft" | "confirmed" | "needs-info";
export type ChatRole = "assistant" | "user" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type EvidenceItem = {
  id: string;
  label: string;
  value: string;
  strength: "strong" | "medium" | "weak";
};

export type StoryCard = {
  id: string;
  title: string;
  context: string;
  role: string;
  actions: string[];
  result: string;
  evidence: EvidenceItem[];
  skills: string[];
  followUps: string[];
  status: StoryStatus;
  sourceQuote: string;
  createdAt: string;
};

export type JobRequirement = {
  id: string;
  label: string;
  category: "hard-skill" | "soft-skill" | "domain" | "experience" | "responsibility";
  priority: "must" | "should" | "nice";
  coverage: SkillCoverageStatus;
  evidenceStoryIds: string[];
};

export type JobAnalysis = {
  id: string;
  title: string;
  company: string;
  rawText: string;
  summary: string;
  keywords: string[];
  requirements: JobRequirement[];
  followUpQuestions: string[];
  updatedAt: string;
};

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

export type AppState = {
  schemaVersion: 1;
  messages: ChatMessage[];
  stories: StoryCard[];
  jobAnalysis: JobAnalysis | null;
  resume: ResumeData;
};

export type CoachAction = "analyze-jd" | "generate-resume";

export type CoachRequest =
  | { action: "analyze-jd"; jdText: string; stories: StoryCard[] }
  | { action: "generate-resume"; stories: StoryCard[]; jobAnalysis: JobAnalysis | null; baseResume: ResumeData };

export type CoachResponse =
  | { action: "analyze-jd"; analysis: JobAnalysis; message: string; usedAI: boolean }
  | { action: "generate-resume"; resume: ResumeData; message: string; usedAI: boolean };

// ── Streaming chat ──────────────────────────────────────────────────────────
//
// /api/coach/chat is the conversational endpoint. It streams the AI's natural
// reply back as text chunks (豆包-style), then sends one final meta event with
// any silently-extracted story card. Stories are accumulated internally and
// used for resume generation; the user never confirms cards.

export type ChatMode = "text" | "voice";

export type ChatRequest = {
  mode: ChatMode;
  history: ChatMessage[];
  jobAnalysis: JobAnalysis | null;
  stories: StoryCard[];
};

/** SSE events sent by /api/coach/chat */
export type ChatStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "meta"; story: StoryCard | null; usedAI: boolean }
  | { type: "done" }
  | { type: "error"; message: string };
