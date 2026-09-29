import { useEffect, useMemo, useRef, useState } from 'react'
import { COST_COLORS, heroByName, ITEM_TYPES, itemById, items as allItems, type Layout } from './data'
import { api } from './api'
import type { HeroRec, ShownPlay } from './community'

export const ROWS = 4
export const COLS = 7
export const MAX_ITEMS = 3

// ---------- 装备图标 ----------

export function ItemIcon({ id, size = 22, onClick, title }: { id: string; size?: number; onClick?: () => void; title?: string }) {
  const it = itemById.get(id)
  if (!it) return null
  const tip = title ?? `${it.name}${it.desc ? '\n' + it.desc : ''}${it.recipe.length ? '\n合成：' + it.recipe.map((r) => itemById.get(r)?.name).join(' + ') : ''}`
  const img = <img src={it.icon} alt={it.name} width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  return onClick ? (
    <button type="button" className="item-icon" style={{ width: size, height: size }} onClick={onClick} title={tip}>
      {img}
    </button>
  ) : (
    <span className="item-icon" style={{ width: size, height: size }} title={tip}>
      {img}
    </span>
  )
}

export function ItemRow({ ids, size = 16 }: { ids?: string[]; size?: number }) {
  if (!ids?.length) return null
  return (
    <span className="item-row">
      {ids.map((id, i) => (
        <ItemIcon key={id + i} id={id} size={size} />
      ))}
    </span>
  )
}

// ---------- 棋盘 ----------

const cellKey = (r: number, c: number) => `${r},${c}`

function invert(positions?: Record<string, string>) {
  const m = new Map<string, string>()
  for (const [h, p] of Object.entries(positions ?? {})) m.set(p, h)
  return m
}

/** 4 行 × 7 列的六边形棋盘；偶数行向右错开半格。第 1 行（最上方）为前排。 */
export function Board({
  layout,
  size = 40,
  selected,
  onCell,
}: {
  layout: Layout
  size?: number
  selected?: string | null
  onCell?: (key: string, hero?: string) => void
}) {
  const byCell = invert(layout.positions)
  return (
    <div className="board" style={{ ['--hex' as string]: `${size}px` }}>
      {Array.from({ length: ROWS }, (_, ri) => {
        const r = ri + 1
        return (
          <div key={r} className={`board-row ${r % 2 === 0 ? 'shift' : ''}`}>
            {Array.from({ length: COLS }, (_, ci) => {
              const key = cellKey(r, ci + 1)
              const hero = byCell.get(key)
              const h = hero ? heroByName.get(hero) : undefined
              const Tag = onCell ? 'button' : 'div'
              return (
                <Tag
                  key={key}
                  type={onCell ? 'button' : undefined}
                  className={`hex ${hero ? 'filled' : ''} ${hero && hero === selected ? 'sel' : ''}`}
                  style={h ? { ['--cost' as string]: COST_COLORS[h.cost] } : undefined}
                  onClick={onCell ? () => onCell(key, hero) : undefined}
                  title={hero ?? (onCell ? '点击放置' : undefined)}
                >
                  {h && <img src={h.avatar} alt={hero} referrerPolicy="no-referrer" />}
                  {hero && layout.items?.[hero]?.length ? (
                    <span className="hex-items" style={{ width: size * 0.78 }}>
                      {layout.items[hero].slice(0, 3).map((id, i) => (
                        <ItemIcon key={id + i} id={id} size={(size * 0.78) / 3} />
                      ))}
                    </span>
                  ) : null}
                </Tag>
              )
            })}
          </div>
        )
      })}
      <div className="board-labels">
        <span>↑ 前排</span>
        <span>后排 ↓</span>
      </div>
    </div>
  )
}

export function hasLayout(l: Layout) {
  return !!(Object.keys(l.positions ?? {}).length || Object.keys(l.items ?? {}).length)
}

// ---------- 装备选择 ----------

function ItemPicker({ rec, onPick, disabled }: { rec: HeroRec; onPick: (id: string) => void; disabled: boolean }) {
  const [type, setType] = useState('成型装备')
  const [q, setQ] = useState('')
  const shown = allItems.filter((i) => (q ? i.name.includes(q) || i.desc.includes(q) : i.type === type))
  return (
    <div className="item-picker">
      {rec.items.length > 0 && (
        <div className="ip-rec">
          <span className="muted small">{rec.source === 'admin' ? `推荐（${rec.updatedBy}）` : '官方阵容常用'}：</span>
          {rec.items.map((id) => (
            <span key={id} className="ip-rec-item">
              <ItemIcon id={id} size={28} onClick={disabled ? undefined : () => onPick(id)} />
              {rec.counts?.[id] ? <small>{rec.counts[id]}</small> : null}
            </span>
          ))}
        </div>
      )}
      <div className="ip-filter">
        <input className="lp-search" placeholder="搜索装备，如：无尽、法强" value={q} onChange={(e) => setQ(e.target.value)} />
        {!q && (
          <div className="seg small">
            {ITEM_TYPES.map((t) => (
              <button type="button" key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ip-grid">
        {shown.map((i) => (
          <ItemIcon key={i.id} id={i.id} size={30} onClick={disabled ? undefined : () => onPick(i.id)} />
        ))}
      </div>
    </div>
  )
}

// ---------- 编辑器 ----------

/**
 * 站位与装备编辑：先点选下方英雄（或棋盘上的英雄），再点棋盘格子放置；
 * 选中英雄后可以给它配最多 3 件装备。
 */
export function LayoutEditor({
  heroes,
  value,
  onChange,
  heroRec,
}: {
  heroes: string[]
  value: Layout
  onChange: (l: Layout) => void
  heroRec: (hero: string) => HeroRec
}) {
  const [sel, setSel] = useState<string | null>(heroes[0] ?? null)
  const positions = value.positions ?? {}
  const itemsOf = (h: string) => value.items?.[h] ?? []

  // 阵容变化后，清掉已不在阵容里的英雄
  useEffect(() => {
    const keep = (o?: Record<string, unknown>) => Object.keys(o ?? {}).every((h) => heroes.includes(h))
    if (!keep(value.positions) || !keep(value.items)) {
      const pick = <T,>(o?: Record<string, T>) =>
        Object.fromEntries(Object.entries(o ?? {}).filter(([h]) => heroes.includes(h))) as Record<string, T>
      onChange({ positions: pick(value.positions), items: pick(value.items) })
    }
    if (!sel || !heroes.includes(sel)) setSel(heroes[0] ?? null)
  }, [heroes.join(',')])

  const setPos = (p: Record<string, string>) => onChange({ ...value, positions: p })
  const setItems = (h: string, list: string[]) => {
    const next = { ...(value.items ?? {}) }
    if (list.length) next[h] = list
    else delete next[h]
    onChange({ ...value, items: next })
  }

  const onCell = (key: string, hero?: string) => {
    if (hero && hero !== sel) return setSel(hero)
    if (!sel) return
    const p = { ...positions }
    if (hero === sel) delete p[sel]
    else {
      // 目标格已有别人时交换位置
      const other = Object.entries(p).find(([, v]) => v === key)?.[0]
      if (other) {
        if (p[sel]) p[other] = p[sel]
        else delete p[other]
      }
      p[sel] = key
      const next = heroes.find((h) => !p[h] && h !== sel)
      if (next) setSel(next)
    }
    setPos(p)
  }

  if (!heroes.length) return <p className="muted small">先在上面选好大成阵容的英雄，再来编辑站位和装备。</p>

  const selItems = sel ? itemsOf(sel) : []
  return (
    <div className="layout-editor">
      <div className="le-bench">
        {heroes.map((h) => {
          const hh = heroByName.get(h)
          return (
            <button
              type="button"
              key={h}
              className={`le-hero ${h === sel ? 'sel' : ''} ${positions[h] ? 'placed' : ''}`}
              style={hh ? { ['--cost' as string]: COST_COLORS[hh.cost] } : undefined}
              onClick={() => setSel(h)}
              title={positions[h] ? '已上场，点棋盘格子可移动' : '未上场'}
            >
              {hh && <img src={hh.avatar} alt="" referrerPolicy="no-referrer" />}
              <span>{h}</span>
              <ItemRow ids={itemsOf(h)} size={12} />
            </button>
          )
        })}
      </div>
      <div className="le-main">
        <Board layout={value} size={44} selected={sel} onCell={onCell} />
        <p className="muted small">
          点英雄 → 点格子放置；点已放置英雄所在格子可取下；目标格有人时互换位置。
          <button type="button" className="link-btn small" onClick={() => setPos({})}>
            清空站位
          </button>
        </p>
      </div>
      {sel && (
        <div className="le-items">
          <div className="le-items-head">
            <b>{sel}</b> 的装备（{selItems.length}/{MAX_ITEMS}）
            {selItems.map((id, i) => (
              <ItemIcon key={id + i} id={id} size={30} onClick={() => setItems(sel, selItems.filter((_, j) => j !== i))} title="点击移除" />
            ))}
            {selItems.length > 0 && (
              <button type="button" className="link-btn small" onClick={() => setItems(sel, [])}>
                清空
              </button>
            )}
          </div>
          <ItemPicker rec={heroRec(sel)} disabled={selItems.length >= MAX_ITEMS} onPick={(id) => setItems(sel, [...selItems, id])} />
        </div>
      )}
    </div>
  )
}

// ---------- 管理员弹窗 ----------

export function LayoutDialog({
  play,
  heroRec,
  onClose,
  onSaved,
}: {
  play: ShownPlay | null
  heroRec: (hero: string) => HeroRec
  onClose: () => void
  onSaved: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState<Layout>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const heroes = useMemo(() => {
    if (!play) return []
    const list = play.late.length ? play.late : play.early
    return [...new Set(list)].filter((h) => heroByName.has(h))
  }, [play])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (play) {
      setValue({ items: { ...(play.items ?? {}) }, positions: { ...(play.positions ?? {}) } })
      setErr('')
      if (!d.open) d.showModal()
    } else if (d.open) d.close()
  }, [play])

  const save = async () => {
    if (!play) return
    setBusy(true)
    setErr('')
    try {
      if (play.community && play.id) await api.setPlayLayout(play.id, value)
      else await api.setDocLayout(play.row, value)
      onSaved()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="about layout-dialog" onClose={onClose}>
      {play && (
        <div className="about-body">
          <header>
            <h2>
              编辑站位与装备 <span className="muted small">· {play.source || '未署名'}{play.community ? ' · 社区投稿' : ` · 原文档第 ${play.row} 行`}</span>
            </h2>
            <button className="icon-btn" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </header>
          <p className="muted small">
            编辑对象：{play.late.length ? '大成阵容' : '过渡阵容'}。
            {play.community ? '管理员修改不会改变审核状态。' : '原文档内容不变，站位与装备单独保存在本站。'}
          </p>
          <LayoutEditor heroes={heroes} value={value} onChange={setValue} heroRec={heroRec} />
          <div className="form-foot">
            {err && <span className="error">{err}</span>}
            <button type="button" className="btn ghost" onClick={() => setValue({})}>
              全部清空
            </button>
            <button type="button" className="btn" disabled={busy} onClick={save}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
