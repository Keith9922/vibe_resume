import { z } from "zod";

const evidenceSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  strength: z.enum(["strong", "medium", "weak"]),
});

export const storyCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string(),
  role: z.string(),
  actions: z.array(z.string()),
  result: z.string(),
  evidence: z.array(evidenceSchema),
  skills: z.array(z.string()),
  followUps: z.array(z.string()),
  status: z.enum(["draft", "confirmed", "needs-info"]),
  sourceQuote: z.string(),
  createdAt: z.string(),
});

const jobRequirementSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(["hard-skill", "soft-skill", "domain", "experience", "responsibility"]),
  priority: z.enum(["must", "should", "nice"]),
  coverage: z.enum(["covered", "weak", "missing"]),
  evidenceStoryIds: z.array(z.string()),
});

export const jobAnalysisSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  rawText: z.string(),
  summary: z.string(),
  keywords: z.array(z.string()),
  requirements: z.array(jobRequirementSchema),
  followUpQuestions: z.array(z.string()),
  updatedAt: z.string(),
});

const resumeExperienceSchema = z.object({
  id: z.string(),
  title: z.string(),
  organization: z.string(),
  period: z.string(),
  bullets: z.array(z.string()),
  skills: z.array(z.string()),
});

export const resumeDataSchema = z.object({
  name: z.string(),
  headline: z.string(),
  location: z.string(),
  email: z.string(),
  phone: z.string(),
  links: z.array(z.string()),
  summary: z.string(),
  skills: z.array(z.string()),
  experiences: z.array(resumeExperienceSchema),
  education: z.array(z.string()),
  notes: z.array(z.string()),
  targetRole: z.string(),
  updatedAt: z.string(),
});

export const coachRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("analyze-jd"),
    jdText: z.string().min(1),
    stories: z.array(storyCardSchema),
  }),
  z.object({
    action: z.literal("generate-resume"),
    stories: z.array(storyCardSchema),
    jobAnalysis: jobAnalysisSchema.nullable(),
    baseResume: resumeDataSchema,
  }),
]);

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["assistant", "user", "system"]),
  content: z.string(),
  createdAt: z.string(),
});

export const chatRequestSchema = z.object({
  mode: z.enum(["text", "voice"]),
  history: z.array(chatMessageSchema).min(1),
  jobAnalysis: jobAnalysisSchema.nullable(),
  stories: z.array(storyCardSchema),
});
