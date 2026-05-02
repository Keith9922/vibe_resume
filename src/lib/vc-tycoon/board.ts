import type { Cell, Deal } from "./types";
import { CORNERS, DEALS } from "./data";

/** 8×8 环形棋盘，共 28 格：4 个角 + 24 个项目格（每边 6 个） */
export const BOARD_SIZE = 28;
export const DEALS_PER_SIDE = 6;

/**
 * 把棋盘 index 映射到 8×8 网格的 [row, col]
 * 顺时针：上 → 右 → 下 → 左
 */
export const GRID_POSITIONS: ReadonlyArray<readonly [number, number]> = (() => {
  const positions: Array<readonly [number, number]> = [];
  for (let c = 0; c < 7; c++) positions.push([0, c]);    // 0..6   顶部
  for (let r = 0; r < 7; r++) positions.push([r, 7]);    // 7..13  右侧
  for (let c = 7; c > 0; c--) positions.push([7, c]);    // 14..20 底部
  for (let r = 7; r > 0; r--) positions.push([r, 0]);    // 21..27 左侧
  return positions;
})();

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 构建一局新棋盘：4 个角固定位置，24 个项目格从案例库随机抽取。
 * 抽取保证三种结局都有：至少 8 个 win + 6 个 mid + 8 个 loss + 2 个补充。
 */
export function buildBoard(rng: () => number = Math.random): Cell[] {
  const wins = DEALS.filter(d => d.outcome === "win");
  const mids = DEALS.filter(d => d.outcome === "mid");
  const losses = DEALS.filter(d => d.outcome === "loss");

  const picked: Deal[] = [
    ...shuffle(wins, rng).slice(0, 9),
    ...shuffle(mids, rng).slice(0, 6),
    ...shuffle(losses, rng).slice(0, 9),
  ];
  // 不足 24 个时从剩余案例补充
  if (picked.length < 24) {
    const used = new Set(picked.map(d => d.id));
    const rest = DEALS.filter(d => !used.has(d.id));
    picked.push(...shuffle(rest, rng).slice(0, 24 - picked.length));
  }
  const dealCells = shuffle(picked, rng).slice(0, 24);

  const cells: Cell[] = [];
  // 顺序：corner0 → 6 deals → corner1 → 6 deals → corner2 → 6 deals → corner3 → 6 deals
  for (let cornerIdx = 0; cornerIdx < 4; cornerIdx++) {
    cells.push({ kind: "corner", ...CORNERS[cornerIdx] });
    const sideStart = cornerIdx * DEALS_PER_SIDE;
    for (let i = 0; i < DEALS_PER_SIDE; i++) {
      cells.push({ kind: "deal", ...dealCells[sideStart + i] });
    }
  }
  return cells;
}
