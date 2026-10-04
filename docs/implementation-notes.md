# Web Resume 实现说明

## 当前 MVP 范围

当前实现聚焦先跑通完整产品链路：

1. 粘贴 JD 并解析岗位能力项。
2. 通过文字对话讲述经历。
3. 将回答提炼成故事卡片。
4. 用户确认或标记需补充。
5. 基于素材生成简历预览。
6. 导出 PDF 和工作区 JSON。
7. 以 PWA 形式支持网页和 App 安装。

实时语音暂不做，录音入口只保留产品占位。后续可以把录音文件上传后接 MiniMax 或其他语音转写服务，再把转写文本送入同一条采集链路。

## AI 策略

`/api/coach` 是统一 AI 入口，支持四类动作：

- `analyze-jd`
- `extract-story`
- `next-question`
- `generate-resume`

服务端会优先读取 MiniMax 配置：

- `MINIMAX_API_KEY`
- `MINIMAX_BASE_URL`
- `MINIMAX_MODEL`

未配置或调用失败时，自动使用本地规则引擎，保证产品链路仍可跑通。

## 事实约束

简历生成不直接根据原始对话自由发挥，而是根据 `StoryCard` 结构化事实生成：

- `context`
- `role`
- `actions`
- `result`
- `evidence`
- `skills`
- `status`

后续接真实 AI 时，也必须保持这个边界：AI 可以追问、整理、润色，但不能编造经历、公司、学历、职位或指标。

## 后续增强

- 登录和云端同步。
- 真实录音转写。
- 多模板 PDF。
- 更严格的 JSON schema 验证和 AI 输出修复。
- JD 历史库和多版本简历管理。
- Playwright 自动化验收脚本或手工验收清单。

