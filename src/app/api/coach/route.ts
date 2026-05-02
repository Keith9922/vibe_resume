import { NextResponse } from "next/server";
import type { CoachRequest, CoachResponse } from "@/lib/types";
import { coachRequestSchema } from "@/lib/coach-schemas";
import { analyzeJobDescription, generateResume } from "@/lib/resume-engine";
import { runMiniMaxCoach } from "@/lib/minimax";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const parsed = coachRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求格式不正确", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const coachRequest = parsed.data as CoachRequest;
  const fallback = runLocalCoach(coachRequest);

  try {
    const response = await runMiniMaxCoach(coachRequest, fallback);
    return NextResponse.json(response);
  } catch (err) {
    console.error("Coach route error:", err);
    return NextResponse.json(fallback);
  }
}

function runLocalCoach(request: CoachRequest): CoachResponse {
  switch (request.action) {
    case "analyze-jd": {
      const analysis = analyzeJobDescription(request.jdText, request.stories);
      return {
        action: "analyze-jd",
        analysis,
        message: `已解析 JD，识别出 ${analysis.requirements.length} 个能力项。接下来会自然地往这些方向引你聊。`,
        usedAI: false,
      };
    }
    case "generate-resume": {
      const resume = generateResume(request.stories, request.jobAnalysis, request.baseResume);
      return {
        action: "generate-resume",
        resume,
        message: "已基于当前对话素材生成简历草稿，没说过的部分留空。",
        usedAI: false,
      };
    }
  }
}
