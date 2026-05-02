import type { AppState, ResumeData } from "@/lib/types";
import { createId, nowIso } from "@/lib/ids";

export const emptyResume: ResumeData = {
  name: "你的姓名",
  headline: "目标岗位 / 个人定位",
  location: "",
  email: "",
  phone: "",
  links: [],
  summary: "当你确认足够素材后，这里会生成一段真实、克制、面向岗位的个人摘要。",
  skills: [],
  experiences: [],
  education: [],
  notes: ["所有内容仅基于已确认故事卡生成，不会自动编造经历或数据。"],
  targetRole: "",
  updatedAt: nowIso(),
};

export function createInitialState(): AppState {
  return {
    schemaVersion: 1,
    messages: [
      {
        id: createId("msg"),
        role: "assistant",
        createdAt: nowIso(),
        content:
          "嗨，我是 Stori。先聊聊吧，不用一上来就写简历——你最想放进简历的那段经历是什么？",
      },
    ],
    stories: [],
    jobAnalysis: null,
    resume: emptyResume,
  };
}
