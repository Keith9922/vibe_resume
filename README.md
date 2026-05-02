# VC Tycoon · 创投大富翁

一个用大富翁玩法重温真实创投史的网页游戏。投或不投？揭晓的是 Insta360、字节跳动、Theranos、WeWork、FTX 这些真实的故事。

## 游戏玩法

- **棋盘**：8×8 环形棋盘，28 个格子（4 个角 + 24 个项目），每局随机生成
- **节奏**：你 vs AI 轮流掷骰子，落到项目格选择 INVEST 或 PASS
- **揭晓**：决策后立刻揭晓真实公司和真实结局，让你看到"如果投了/没投会怎样"
- **角落格**：START（路过 +$10M）/ LP MEETING（业绩差被撤资）/ DEMO DAY（+$20M）/ BLACK SWAN（黑天鹅）
- **胜负**：先到 $500M 获胜；现金归零则破产

## 技术栈

- **框架**：Next.js 15 App Router · React 19 · TypeScript
- **样式**：原生 CSS（零运行时依赖）
- **状态管理**：`useReducer`，纯函数 reducer + 副作用隔离在组件层
- **AI 对手**：在 [src/lib/vc-tycoon/ai.ts](src/lib/vc-tycoon/ai.ts) — 基于公开信息（不偷看 outcome）做加权概率决策

## 项目结构

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # 入口
│   └── globals.css              # 完整设计系统
├── components/vc-tycoon/
│   ├── VCTycoon.tsx             # 主客户端组件，编排副作用
│   ├── Header.tsx               # HUD：双方资金/组合/回合
│   ├── Board.tsx                # 环形棋盘 + 中心骰子
│   ├── Sidebar.tsx              # 决策面板 + 投资组合 + 日志
│   └── Modals.tsx               # 结果揭晓 + 游戏结束
└── lib/vc-tycoon/
    ├── types.ts                 # 类型定义
    ├── data.ts                  # 36 个真实案例 + 4 个角落格
    ├── board.ts                 # 棋盘构建（每局随机抽取）
    ├── game.ts                  # 纯函数 reducer
    └── ai.ts                    # AI 决策逻辑
```

## 本地运行

```bash
npm install
npm run dev
# 打开 http://localhost:3000
```

```bash
npm run typecheck   # TypeScript 检查
npm run lint        # ESLint
npm run build       # 生产构建
```

## 部署到 Vercel

最简单的两种方式（任选其一）：

### 方式 1：通过 GitHub 自动部署（推荐）

1. 把代码 push 到 GitHub 仓库
2. 登录 [vercel.com](https://vercel.com) → New Project
3. 选择仓库 → Framework Preset 自动识别为 Next.js → Deploy

### 方式 2：通过 Vercel CLI

```bash
npm i -g vercel
vercel              # 首次部署，按提示绑定项目
vercel --prod       # 部署到生产域名
```

无需任何环境变量，开箱即用。

## 设计原则

1. **真实优先**：每个项目格背后都是真实公司，胜负倍数参考真实退出/估值
2. **延迟揭晓**：决策时只能看到"假名 + 一句话描述 + 轮次 + 金额"，模拟 VC 真实信息不对称
3. **AI 公平**：AI 看到的信息和你完全一样，靠概率策略而非作弊
4. **教育意义**：玩完一局，你会记住为什么 ofo 翻车、为什么 Insta360 是宝藏

## V2 路线图

- [ ] 多轮加注（种子轮投了能不能跟投 A/B 轮）
- [ ] 尽调机制（花钱换信息卡）
- [ ] 回报随时间揭晓而不是即时
- [ ] 多人对战（房间码）
- [ ] 更复杂的事件卡（市场周期、监管收紧）
- [ ] 案例难度分级 / 时代主题局（2000 互联网泡沫局、2021 加密局）

---

*VC Tycoon · 投或不投，这是一个问题。*
