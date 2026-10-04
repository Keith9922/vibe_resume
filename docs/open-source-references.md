# Web Resume 开源项目调研

调研时间：2026-04-26

## 已拉取到本地

| 项目 | 本地路径 | 许可证 | 技术栈 | 适合程度 | 结论 |
| --- | --- | --- | --- | --- | --- |
| amruthpillai/reactive-resume | `references/reactive-resume` | MIT | TanStack Start, React 19, Tailwind, Drizzle, PostgreSQL, ORPC, AI SDK, Puppeteer | 高 | 最适合作为可商用简历编辑器/模板/PDF/AI 能力参考底座 |
| olyaiy/resume-lm | `references/resume-lm` | AGPL-3.0 | Next.js 15, React 19, Tailwind, Supabase, AI SDK, React PDF, Stripe | 中高 | 产品方向最接近，但 AGPL 不适合直接闭源改造，只建议参考思路 |

## 候选但未拉取

| 项目 | 许可证 | 原因 |
| --- | --- | --- |
| xitanggg/open-resume | AGPL-3.0 | 解析和构建能力强，但许可证不适合作为闭源商业底座 |
| rendercv/rendercv | MIT | PDF/排版能力强，但偏 Python CLI/YAML，不适合作为 Web 语音对话产品主底座 |
| sadanandpai/resume-builder | MIT | 简洁单页简历构建器，可参考 UI，但 AI/JD/语音能力弱 |
| codinginflow/nextjs-15-ai-resume-builder | 无明确许可证 | 不建议复用代码 |
| rrs301/AI-Resume-Builder | 无明确许可证 | 不建议复用代码 |

## 可复用模块判断

### reactive-resume

可重点参考：

- 简历数据 schema：`references/reactive-resume/src/schema/resume/data.ts`
- 简历预览和模板：`references/reactive-resume/src/components/resume`
- PDF 打印链路：`references/reactive-resume/src/routes/printer/$resumeId.tsx`、`references/reactive-resume/src/integrations/orpc/services/printer.ts`
- AI 服务：`references/reactive-resume/src/integrations/orpc/services/ai.ts`
- AI 修改简历工具：`references/reactive-resume/src/integrations/ai/tools/patch-resume.ts`
- 简历分析、JD tailoring prompt：`references/reactive-resume/src/integrations/ai/prompts`

优点：

- MIT，可商用。
- 简历编辑、模板、分享、PDF 导出、AI 分析已经比较完整。
- 有 JSON Patch 修改简历的思路，适合接入“语音助手边问边改简历”。

风险：

- 技术栈偏新，TanStack Start + ORPC + Drizzle 学习成本比普通 Next.js 高。
- 如果直接基于它改，会先被它现有产品结构牵着走。

### resume-lm

可重点参考：

- AI Chat 接口：`references/resume-lm/src/app/api/chat/route.ts`
- AI tools：`references/resume-lm/src/lib/tools.ts`
- JD 解析和定制：`references/resume-lm/src/utils/actions/jobs/ai.ts`
- 文本导入到简历：`references/resume-lm/src/utils/actions/resumes/ai.ts`
- 简历助手组件：`references/resume-lm/src/components/resume/assistant`
- JD 定制弹窗：`references/resume-lm/src/components/resume/management/dialogs/create-tailored-resume-dialog.tsx`

优点：

- Next.js 路线更接近我们想做的 MVP。
- 有 JD 解析、定制简历、聊天助手、简历评分等模块。

风险：

- AGPL-3.0：如果基于它改造成在线服务，通常需要公开修改后的源代码。
- 产品和代码里有较多订阅、营销、历史包袱，不建议整仓直接改。

## 建议路线

第一版不要完整 fork 某个仓库。建议新建我们自己的 Next.js 项目，然后：

1. 参考 `reactive-resume` 的简历 schema、模板渲染、PDF 打印、JSON Patch 修改模型。
2. 参考 `resume-lm` 的 JD 解析、AI tools、聊天助手交互，但不要直接复制 AGPL 代码。
3. 我们自己的核心数据层增加“对话采集事实库”：
   - `interview_sessions`
   - `conversation_turns`
   - `experience_stories`
   - `evidence_items`
   - `job_descriptions`
   - `resume_versions`
4. 先做文字/录音转写 MVP，再接实时语音。

推荐产品形态：

- 左栏：AI 面试官/朋友式对话。
- 中栏：被抽取出的故事卡片、事实证据、待追问问题。
- 右栏：实时简历预览和岗位匹配提示。

推荐技术栈：

- Next.js + React + Tailwind + shadcn/ui
- PostgreSQL + Prisma
- OpenAI SDK / AI SDK
- OpenAI Realtime 或先用录音转写 + 文本模型
- Playwright/Puppeteer 导出 PDF

