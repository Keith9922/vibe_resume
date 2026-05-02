export type AchievementId =
  | "first_invest"
  | "first_win"
  | "avoid_disaster"
  | "avoid_three"
  | "all_in_win"
  | "lp_pass"
  | "unicorn"
  | "rich";

export interface Achievement {
  id: AchievementId;
  name: string;
  icon: string;
  desc: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first_invest", name: "初出茅庐", icon: "🎯", desc: "完成你的第一笔投资" },
  { id: "first_win", name: "本垒打", icon: "⚾", desc: "投中第一个 5x 以上回报项目" },
  { id: "avoid_disaster", name: "避雷专家", icon: "🛡️", desc: "PASS 掉一个归零项目" },
  { id: "avoid_three", name: "风控大师", icon: "🧿", desc: "PASS 掉 3 个归零项目" },
  { id: "all_in_win", name: "豪赌赢家", icon: "🎰", desc: "ALL IN 一个项目并成功" },
  { id: "lp_pass", name: "GP 称职", icon: "📊", desc: "通过 LP 季度考核" },
  { id: "unicorn", name: "独角兽猎手", icon: "🦄", desc: "投中一个 10x 以上项目" },
  { id: "rich", name: "年度最佳", icon: "👑", desc: "达成 $500M 胜利" },
];
