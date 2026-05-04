import { NextResponse } from "next/server";
import type { GenerateResumeRequest, GenerateResumeResponse, ResumeData, ResumeExperience } from "@/lib/types";
import { buildResumePrompt } from "@/lib/interview-prompts";
import { runMiniMaxJsonTask } from "@/lib/minimax";
import { generateId } from "@/lib/ids";
import { DEFAULT_RESUME } from "@/lib/storage";

export async function POST(request: Request) {
  let body: GenerateResumeRequest;
  try {
    body = (await request.json()) as GenerateResumeRequest;
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const { stories = [], jd = null, baseResume } = body;

  if (stories.length === 0) {
    return NextResponse.json({ error: "缺少故事卡，无法生成简历" }, { status: 400 });
  }

  const payload = {
    stories: stories.map((s) => ({
      title: s.title,
      context: s.context,
      role: s.role,
      actions: s.actions,
      result: s.result,
      skills: s.skills,
    })),
    base: baseResume ?? null,
  };

  const ai = await runMiniMaxJsonTask<unknown>(
    buildResumePrompt(jd),
    payload,
    { temperature: 0.35, maxTokens: 2400 },
  );

  const resume = normalizeResume(ai.data, stories, baseResume);

  const response: GenerateResumeResponse = {
    action: "generate-resume",
    resume,
    message: ai.usedAI
      ? "已生成简历草稿。所有内容均基于已确认事实，未补充信息已留空。"
      : "AI 暂时不可用，已基于故事卡生成基础版本。",
    usedAI: ai.usedAI,
  };
  return NextResponse.json(response);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeResume(
  data: unknown,
  stories: GenerateResumeRequest["stories"],
  base?: Partial<ResumeData>,
): ResumeData {
  const r = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
  const exps = Array.isArray(r.experiences) ? r.experiences : [];

  const experiences: ResumeExperience[] = exps.length > 0
    ? exps.map((e, i) => normalizeExperience(e, i))
    : stories.map((s) => ({
        id: generateId("exp"),
        title: s.title,
        organization: "",
        period: "",
        bullets: [s.role, ...s.actions, s.result].filter(Boolean),
        skills: s.skills ?? [],
      }));

  return {
    name: str(r.name) || base?.name || "",
    headline: str(r.headline) || base?.headline || "",
    location: str(r.location) || base?.location || "",
    email: str(r.email) || base?.email || "",
    phone: str(r.phone) || base?.phone || "",
    links: arrStr(r.links) ?? base?.links ?? [],
    summary: str(r.summary) || base?.summary || "",
    skills: arrStr(r.skills) ?? base?.skills ?? [],
    experiences,
    education: arrStr(r.education) ?? base?.education ?? [],
    notes: arrStr(r.notes) ?? base?.notes ?? [],
    targetRole: str(r.targetRole) || base?.targetRole || "",
    updatedAt: new Date().toISOString(),
    ...(base ? {} : DEFAULT_RESUME),
  } as ResumeData;
}

function normalizeExperience(raw: unknown, index: number): ResumeExperience {
  const r = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  return {
    id: str(r.id) || generateId(`exp-${index}`),
    title: str(r.title),
    organization: str(r.organization),
    period: str(r.period),
    bullets: arrStr(r.bullets),
    skills: arrStr(r.skills),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arrStr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}
