import type { Combo } from './data'

/** 包含全部已选英雄的组合（对应原表格里 FILTER + 0/1 矩阵相乘） */
export function matchCombos(combos: Combo[], selected: string[]): Combo[] {
  return combos.filter((c) => selected.every((h) => c.heroes.includes(h)))
}

/** 候选组合里出现过的英雄，其余英雄已经不可能是本局尊者 */
export function possibleHeroes(candidates: Combo[]): Set<string> {
  return new Set(candidates.flatMap((c) => c.heroes))
}

/**
 * 下一步最值得确认的英雄：出现在候选组合中的次数越接近一半，
 * 无论"有"或"没有"都能排除最多组合。
 */
export function bestNextPicks(candidates: Combo[], selected: string[], limit = 3): string[] {
  if (candidates.length < 2) return []
  const count = new Map<string, number>()
  for (const c of candidates)
    for (const h of c.heroes) if (!selected.includes(h)) count.set(h, (count.get(h) ?? 0) + 1)
  const half = candidates.length / 2
  return [...count.entries()]
    .filter(([, n]) => n < candidates.length)
    .sort((a, b) => Math.abs(a[1] - half) - Math.abs(b[1] - half))
    .slice(0, limit)
    .map(([h]) => h)
}
