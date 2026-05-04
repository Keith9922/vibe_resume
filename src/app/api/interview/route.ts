import { NextResponse } from "next/server";
import type { InterviewApiResponse, InterviewPhase, InterviewRequest } from "@/lib/types";
import { advancePhase, buildInterviewSystemPrompt, FALLBACK_QUESTIONS } from "@/lib/interview-prompts";
import { runMiniMaxInterview } from "@/lib/minimax";

export async function POST(request: Request) {
  let body: InterviewRequest;
  try {
    body = (await request.json()) as InterviewRequest;
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const { messages = [], jd = null, phase = "intro", turnCount = 0 } = body;

  // Determine the next phase BEFORE asking the AI, so the prompt is correctly scoped.
  // turnCount represents the number of completed user→assistant turns so far.
  const nextPhase: InterviewPhase = advancePhase(phase, turnCount);

  // Special-case the very first message (no user input yet)
  if (messages.length === 0) {
    const fallback = FALLBACK_QUESTIONS["intro"];
    const ai = await runMiniMaxInterview(
      buildInterviewSystemPrompt(jd, "intro"),
      [{ role: "user", content: "请开始访谈。" }],
      { temperature: 0.6, maxTokens: 200 },
    );
    const message = ai.message?.trim() || fallback;
    const response: InterviewApiResponse = { action: "interview", message, phase: "intro", usedAI: ai.usedAI };
    return NextResponse.json(response);
  }

  const ai = await runMiniMaxInterview(
    buildInterviewSystemPrompt(jd, nextPhase),
    messages,
    { temperature: 0.7, maxTokens: 220 },
  );

  const message = ai.message?.trim() || FALLBACK_QUESTIONS[nextPhase];
  const response: InterviewApiResponse = {
    action: "interview",
    message,
    phase: nextPhase,
    usedAI: ai.usedAI,
  };
  return NextResponse.json(response);
}
