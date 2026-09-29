import heroesJson from './data/heroes.json'
import combosJson from './data/combos.json'
import playsJson from './data/plays.json'
import metaJson from './data/meta.json'
import itemsJson from './data/items.json'

export interface Hero {
  id: string
  name: string
  cost: number
  avatar: string
  traits: string[]
  /** 出现在原文档的尊者组合里 */
  exalted: boolean
  /** 可能成为尊者：拥有 3 个及以上羁绊的弈子不会被选中 */
  exaltable: boolean
  /** 官方推荐阵容里该英雄携带的装备，按次数排序 */
  items: { id: string; count: number }[]
}

export interface Item {
  id: string
  name: string
  type: string
  icon: string
  desc: string
  recipe: string[]
}

/** 大成阵容的站位与装备：positions 英雄 → "行,列"（4×7，第 1 行为前排）；items 英雄 → 装备 id */
export interface Layout {
  items?: Record<string, string[]>
  positions?: Record<string, string>
}

export interface Combo {
  id: number
  heroes: string[]
}

export interface Play {
  row: number
  comboId: number | null
  source: string
  early: string[]
  earlyTips: string
  late: string[]
  lateTips: string
  links: string[]
  items?: Record<string, string[]>
  positions?: Record<string, string>
}

export const heroes = heroesJson as Hero[]
export const combos = combosJson as Combo[]
/** 原文档中的全部玩法，含未能匹配到组合的条目（仅用于署名统计） */
export const allPlays = playsJson as Play[]
export const plays = allPlays.filter((p) => p.comboId != null)
export const meta = metaJson
export const items = itemsJson as Item[]
export const itemById = new Map(items.map((i) => [i.id, i]))
export const ITEM_TYPES = [...new Set(items.map((i) => i.type))]

export const heroByName = new Map(heroes.map((h) => [h.name, h]))
export const exaltableHeroes = heroes.filter((h) => h.exaltable)

export const playsByCombo = new Map<number, Play[]>()
for (const p of plays) {
  const list = playsByCombo.get(p.comboId!) ?? []
  list.push(p)
  playsByCombo.set(p.comboId!, list)
}

// 原文档下拉框里用的费用色
export const COST_COLORS: Record<number, string> = {
  1: '#81868F',
  2: '#45B076',
  3: '#2972F4',
  4: '#9A38D7',
  5: '#F88825',
}
