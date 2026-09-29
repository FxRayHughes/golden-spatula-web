import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { api, type CommunityCombo, type CommunityPlay } from './api'
import { combos as baseCombos, heroByName, playsByCombo as basePlaysByCombo, type Combo, type Play } from './data'

/** 页面上展示的一条玩法：原文档（row）或社区投稿（id） */
export type ShownPlay = Play & { id?: string; community?: boolean; layoutBy?: string }

export const COMMUNITY_COMBO_START = 1001

export function comboLabel(id: number) {
  return id >= COMMUNITY_COMBO_START ? `新${id - COMMUNITY_COMBO_START + 1}` : String(id)
}

export function toShown(p: CommunityPlay): ShownPlay {
  return { ...p, row: 0, comboId: p.comboId ?? null, community: true }
}

export interface HeroRec {
  items: string[]
  /** admin：管理员维护；official：官方推荐阵容统计 */
  source: 'admin' | 'official' | 'none'
  updatedBy?: string
  counts?: Record<string, number>
}

/** 官方阵容统计（后端离线时的默认值） */
export function officialRec(hero: string): HeroRec {
  const official = heroByName.get(hero)?.items ?? []
  return {
    items: official.map((i) => i.id),
    source: official.length ? 'official' : 'none',
    counts: Object.fromEntries(official.map((i) => [i.id, i.count])),
  }
}

/** 英雄推荐装备（管理员覆盖 > 官方统计），由 App 提供 */
export const HeroRecContext = createContext<(hero: string) => HeroRec>(officialRec)

export interface Community {
  /** 后端是否可用；纯静态部署时为 false，页面只展示原文档数据 */
  online: boolean | null
  combos: Combo[]
  playsByCombo: Map<number, ShownPlay[]>
  heroRec: (hero: string) => HeroRec
  reload: () => void
}

type CommunityData = Awaited<ReturnType<typeof api.community>>
const EMPTY: CommunityData = { plays: [], combos: [], docLayouts: {}, heroItems: {} }

export function useCommunity(): Community {
  const [online, setOnline] = useState<boolean | null>(null)
  const [data, setData] = useState<CommunityData>(EMPTY)

  const reload = useCallback(() => {
    api
      .community()
      .then((d) => {
        setData({ ...EMPTY, ...d })
        setOnline(true)
      })
      .catch(() => setOnline(false))
  }, [])
  useEffect(reload, [reload])

  return useMemo(() => {
    const map = new Map<number, ShownPlay[]>()
    for (const [id, list] of basePlaysByCombo)
      map.set(
        id,
        list.map((p) => {
          const l = data.docLayouts[String(p.row)]
          return l ? { ...p, items: l.items, positions: l.positions, layoutBy: l.updatedBy } : p
        }),
      )
    for (const p of data.plays) {
      if (!p.comboId) continue
      map.set(p.comboId, [...(map.get(p.comboId) ?? []), toShown(p)])
    }
    const approved = data.combos.filter((c) => c.id).map((c) => ({ id: c.id!, heroes: c.heroes }))
    const heroRec = (hero: string): HeroRec => {
      const official = heroByName.get(hero)?.items ?? []
      const counts = Object.fromEntries(official.map((i) => [i.id, i.count]))
      const custom = data.heroItems[hero]
      if (custom) return { items: custom.items, source: 'admin', updatedBy: custom.updatedBy, counts }
      return { items: official.map((i) => i.id), source: official.length ? 'official' : 'none', counts }
    }
    return { online, combos: [...baseCombos, ...approved], playsByCombo: map, heroRec, reload }
  }, [online, data, reload])
}

/** 极简 hash 路由：#/board、#/submit?combo=39 */
export function useRoute(): { page: string; params: URLSearchParams } {
  const parse = () => {
    const [p, q] = location.hash.replace(/^#\/?/, '').split('?')
    return { page: p || 'finder', params: new URLSearchParams(q) }
  }
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}

export function go(hash: string) {
  location.hash = hash
  scrollTo({ top: 0 })
}

export type { CommunityCombo }
