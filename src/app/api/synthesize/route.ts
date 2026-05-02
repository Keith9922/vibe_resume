import { NextResponse } from "next/server";
import type { StoryCard, SynthesizeRequest, SynthesizeResponse } from "@/lib/types";
import { buildSynthesisPrompt } from "@/lib/interview-prompts";
import { runMiniMaxJsonTask } from "@/lib/minimax";
import { generateId } from "@/lib/ids";

export async function POST(request: Request) {
  let body: SynthesizeRequest;
  try {
    body = (await request.json()) as SynthesizeRequest;
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const { messages = [], jd = null } = body;

  if (messages.length < 2) {
    return NextResponse.json(
      { error: "对话太短，无法整理故事卡。请先完成访谈。" },
      { status: 400 },
    );
  }

  // Build a transcript-style payload
  const transcript = messages
    .map((m) => (m.role === "user" ? `[用户] ${m.content}` : `[教练] ${m.content}`))
    .join("\n\n");

  const ai = await runMiniMaxJsonTask<unknown>(
    buildSynthesisPrompt(jd),
    `## 访谈对话记录\n\n${transcript}\n\n请根据上述对话提取故事卡。`,
    { temperature: 0.3, maxTokens: 2400 },
  );

  // Normalize whatever the model returned into a list of valid StoryCards.
  const stories = normalizeStories(ai.data);

  if (stories.length === 0) {
    // Fall back: return a single seed story from the conversation
    const seed = buildFallbackStory(messages);
    return NextResponse.json<SynthesizeResponse>({
      action: "synthesize",
      stories: [seed],
      message: "AI 未能成功提取，已为你生成一份待补充的故事卡。",
      usedAI: ai.usedAI,
    });
  }

  const response: SynthesizeResponse = {
    action: "synthesize",
    stories,
    message: `已整理出 ${stories.length} 张故事卡。请确认事实是否准确。`,
    usedAI: ai.usedAI,
  };
  return NextResponse.json(response);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeStories(data: unknown): StoryCard[] {
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  return list
    .map((raw): StoryCard | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const title = str(r.title);
      if (!title) return null;
      return {
        id: str(r.id) || generateId("story"),
        title,
        context: str(r.context),
        role: str(r.role),
        actions: arrStr(r.actions),
        result: str(r.result),
        skills: arrStr(r.skills),
        followUps: arrStr(r.followUps),
        status: ["draft", "confirmed", "needs-info"].includes(str(r.status))
          ? (str(r.status) as StoryCard["status"])
          : "draft",
        sourceQuote: str(r.sourceQuote),
        createdAt: str(r.createdAt) || new Date().toISOString(),
      };
    })
    .filter((s): s is StoryCard => s !== null);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arrStr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function buildFallbackStory(messages: { role: string; content: string }[]): StoryCard {
  const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join(" ");
  const firstSentence = userText.split(/[。.!?]/)[0]?.slice(0, 40) || "经历整理";
  return {
    id: generateId("story"),
    title: firstSentence,
    context: "（待补充：发生的时间、地点、团队背景）",
    role: "（待补充：你具体负责的事情）",
    actions: ["（待补充：你做了哪些具体的事情）"],
    result: "（待补充：结果与数据）",
    skills: [],
    followUps: ["补充背景的具体信息（时间、公司/学校）", "补充行动的具体细节", "补充结果的量化数据"],
    status: "needs-info",
    sourceQuote: userText.slice(0, 120),
    createdAt: new Date().toISOString(),
  };
}
