import { runMiniMaxJsonTask } from "@/lib/minimax";

/**
 * /api/voice-progress
 *
 * Called periodically (every 3-4 user turns) by the live voice UI to render
 * the "已采集" sidebar. Sends the conversation transcript snapshot to
 * MiniMax M2.7, gets back structured STAR-slot progress per detected story.
 *
 * Output shape is constant — UI binds to slots by name, not order, so partial
 * results are safe to render.
 *
 * Cheap call: typical ~3000 input tokens + small output ≈ ~¥0.005 / probe.
 * One session ≈ 8-10 probes ≈ ~¥0.05.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

type ProbeRequest = {
  // Transcript snapshot: ordered turns. Most recent last.
  turns: Array<{ role: "user" | "assistant"; text: string }>;
};

type Story = {
  /** Stable handle the UI uses to keep cards in the same order across probes. */
  id: string;
  /** Short label like "校园二手交易小程序". */
  label: string;
  /** STAR slot fill: 0 = not yet, 1 = partial, 2 = complete. */
  slots: {
    context: 0 | 1 | 2;   // 场景 (when / where / why)
    role: 0 | 1 | 2;      // 用户的具体职责
    actions: 0 | 1 | 2;   // 做了什么 (≥2 specific actions)
    result: 0 | 1 | 2;    // 结果 / 数据 / 反馈
  };
  /** A short natural-language reason for the slot rating, used for tooltips. */
  notes?: string;
};

type ProbeResponse = {
  stories: Story[];
  /** True when we judge there's enough material to suggest wrapping up. */
  ready_to_wrap: boolean;
  /** Coach's suggestion text (1 sentence) shown in the UI banner. */
  hint?: string;
};

const SYSTEM = `你是 Stori 的"对话进度评估器"。
读用户和 AI 教练的对话片段，判断**已经攒到了几段可以写进简历的经历**，以及**每段 STAR 4 个槽位**填到什么程度。

# 槽位评分规则

每个槽位评 0/1/2：
- **0**：完全没提到
- **1**：提到了但不够具体（例如只说"做过一个校园项目"，没说什么时候、什么团队）
- **2**：清晰、具体（场景有时间地点、角色明确说"我"做、动作至少 2 件具体的事、结果有数据/反馈/上线状态）

# 注意

- **不要太严格**——这是一个温和的简历助手，不是审计。模糊但可信的就给 1 分。
- 一个对话里可能有多段经历，按用户提到的顺序列。
- 如果用户还在介绍同一段经历的不同角度，不要拆成多段。
- ready_to_wrap = true 当：≥2 段经历，每段 actions+result ≥1 分，且 context+role 至少有一段是 2 分。
- hint 写成给用户看的话，1 句，不要"评估""分数"这种词。例：
  - 没经历："还没聊到具体经历呢，可以从最近做过的项目说起"
  - 1 段没结果："这段挺有料了，再说说当时的结果或反馈？"
  - ≥2 段全 2 分："攒得差不多了，要不让我整理一版试试？"

# 输出
严格 JSON，shape 必须匹配：
{
  "stories": [
    {
      "id": "story-1",
      "label": "短标题，10字内",
      "slots": {"context": 0|1|2, "role": 0|1|2, "actions": 0|1|2, "result": 0|1|2},
      "notes": "可选，一句话简评"
    }
  ],
  "ready_to_wrap": true|false,
  "hint": "给用户看的话，1 句"
}

不要其他任何文字、不要 markdown。`;

export async function POST(request: Request) {
  let body: ProbeRequest;
  try {
    body = (await request.json()) as ProbeRequest;
  } catch {
    return jsonError(400, "请求体必须是合法 JSON");
  }

  if (!Array.isArray(body.turns) || body.turns.length === 0) {
    return jsonResponse({ stories: [], ready_to_wrap: false, hint: "还没开始聊" });
  }

  // Send only the most recent ~20 turns to keep token usage bounded
  const recent = body.turns.slice(-20);
  const transcript = recent.map((t) => `${t.role === "user" ? "用户" : "教练"}：${t.text}`).join("\n");

  const { data, usedAI } = await runMiniMaxJsonTask<ProbeResponse>(SYSTEM, transcript, {
    temperature: 0.1,
    maxTokens: 800,
  });

  if (!usedAI || !data) {
    // Fallback: count user turns as a coarse proxy. No exotic structure.
    const userTurns = body.turns.filter((t) => t.role === "user").length;
    return jsonResponse({
      stories: [],
      ready_to_wrap: userTurns >= 12,
      hint: userTurns >= 6 ? "聊了不少，再多说几段就够了" : undefined,
    });
  }

  // Sanity-check & normalise the AI's response to the strict shape
  const stories: Story[] = Array.isArray(data.stories)
    ? data.stories.slice(0, 6).map((s, i) => ({
        id: typeof s.id === "string" && s.id ? s.id : `story-${i + 1}`,
        label: typeof s.label === "string" ? s.label.slice(0, 30) : `经历 ${i + 1}`,
        slots: {
          context: clampSlot(s.slots?.context),
          role: clampSlot(s.slots?.role),
          actions: clampSlot(s.slots?.actions),
          result: clampSlot(s.slots?.result),
        },
        notes: typeof s.notes === "string" ? s.notes.slice(0, 80) : undefined,
      }))
    : [];

  return jsonResponse({
    stories,
    ready_to_wrap: !!data.ready_to_wrap,
    hint: typeof data.hint === "string" ? data.hint.slice(0, 60) : undefined,
  });
}

function clampSlot(v: unknown): 0 | 1 | 2 {
  if (v === 1) return 1;
  if (v === 2) return 2;
  return 0;
}

function jsonResponse(body: ProbeResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
