import { useEffect, useState } from 'react'
import { adminSession, api } from '../api'
import { COST_COLORS, heroes, ITEM_TYPES, itemById, items, meta } from '../data'
import type { Community } from '../community'
import { ItemIcon } from '../layout'

const MAX_REC = 6

function HeroGrid({ value, onPick }: { value: string; onPick: (h: string) => void }) {
  return (
    <div className="lp-grid">
      {heroes.map((h) => (
        <button
          type="button"
          key={h.name}
          className={`lp-hero ${value === h.name ? 'on' : ''}`}
          style={{ ['--cost' as string]: COST_COLORS[h.cost] }}
          onClick={() => onPick(h.name)}
          title={h.traits.join(' / ')}
        >
          <img src={h.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <span>{h.name}</span>
        </button>
      ))}
    </div>
  )
}

function ItemDetail({ id }: { id: string }) {
  const it = itemById.get(id)
  if (!it) return null
  return (
    <div className="item-detail">
      <ItemIcon id={id} size={36} />
      <div>
        <b>{it.name}</b> <span className="muted small">{it.type}</span>
        {it.recipe.length > 0 && (
          <span className="recipe">
            {' '}
            = {it.recipe.map((r, i) => (
              <span key={r + i}>
                {i > 0 && ' + '}
                <ItemIcon id={r} size={18} /> {itemById.get(r)?.name}
              </span>
            ))}
          </span>
        )}
        <p className="small">{it.desc}</p>
      </div>
    </div>
  )
}

export default function Items({ community }: { community: Community }) {
  const [hero, setHero] = useState(heroes.find((h) => h.items.length)?.name ?? heroes[0].name)
  const [type, setType] = useState('成型装备')
  const [q, setQ] = useState('')
  const rec = community.heroRec(hero)
  const shown = items.filter((i) => (q ? i.name.includes(q) || i.desc.includes(q) : i.type === type))
  return (
    <>
      <section className="panel">
        <h2>英雄推荐装备</h2>
        <p className="muted small">
          默认来自金铲铲官方资料库的 {meta.itemSource.lineups} 套「画之灵」推荐阵容（{meta.itemSource.authors.slice(0, 4).join('、')} 等）中该英雄携带装备的次数统计；管理员修改过的以管理员为准。
        </p>
        <HeroGrid value={hero} onPick={setHero} />
        <div className="rec-box">
          <h3>
            {hero}
            <span className="muted small">
              {' '}
              · {rec.source === 'admin' ? `管理员 ${rec.updatedBy} 推荐` : rec.source === 'official' ? '官方阵容统计' : '暂无推荐'}
            </span>
          </h3>
          {rec.items.length === 0 && <p className="muted">官方推荐阵容里还没有出现这个英雄带装备的情况。</p>}
          <div className="rec-list">
            {rec.items.map((id) => (
              <div key={id} className="rec-item">
                <ItemDetail id={id} />
                {rec.counts?.[id] ? <span className="muted small">官方阵容 {rec.counts[id]} 次</span> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>装备图鉴（{items.length}）</h2>
        <div className="ip-filter">
          <input className="lp-search" placeholder="搜索装备名称或效果" value={q} onChange={(e) => setQ(e.target.value)} />
          {!q && (
            <div className="seg small">
              {ITEM_TYPES.map((t) => (
                <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="rec-list">
          {shown.map((i) => (
            <div key={i.id} className="rec-item">
              <ItemDetail id={i.id} />
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/** 管理后台：维护英雄推荐装备（覆盖官方统计） */
export function HeroItemsEditor({ community }: { community: Community }) {
  const [hero, setHero] = useState(heroes[0].name)
  const rec = community.heroRec(hero)
  const [list, setList] = useState<string[]>(rec.items)
  const [type, setType] = useState('成型装备')
  const [msg, setMsg] = useState('')
  const recKey = rec.items.join(',')
  useEffect(() => setMsg(''), [hero])
  useEffect(() => setList(rec.items), [hero, recKey])
  const official = heroes.find((h) => h.name === hero)?.items ?? []
  const save = async (items: string[]) => {
    try {
      await api.setHeroItems(hero, items)
      setMsg(items.length ? '已保存' : '已恢复为官方统计')
      community.reload()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  if (!adminSession.get()) return null
  return (
    <div className="hero-items-editor">
      <p className="muted small">选择英雄，调整推荐装备（最多 {MAX_REC} 件，按顺序展示）。保存为空即恢复官方阵容统计。</p>
      <HeroGrid value={hero} onPick={setHero} />
      <div className="rec-box">
        <h3>
          {hero}
          <span className="muted small"> · 当前：{rec.source === 'admin' ? `管理员 ${rec.updatedBy}` : rec.source === 'official' ? '官方统计' : '无'}</span>
        </h3>
        <div className="le-items-head">
          {list.map((id, i) => (
            <ItemIcon key={id + i} id={id} size={34} onClick={() => setList(list.filter((_, j) => j !== i))} title="点击移除" />
          ))}
          {list.length === 0 && <span className="muted small">空</span>}
        </div>
        {official.length > 0 && (
          <p className="small">
            官方统计：
            {official.map((o) => (
              <span key={o.id} className="ip-rec-item">
                <ItemIcon id={o.id} size={24} onClick={() => list.length < MAX_REC && setList([...list, o.id])} />
                <small>{o.count}</small>
              </span>
            ))}
          </p>
        )}
        <div className="seg small">
          {ITEM_TYPES.map((t) => (
            <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="ip-grid">
          {items
            .filter((i) => i.type === type)
            .map((i) => (
              <ItemIcon key={i.id} id={i.id} size={30} onClick={() => list.length < MAX_REC && !list.includes(i.id) && setList([...list, i.id])} />
            ))}
        </div>
        <div className="form-foot">
          {msg && <span className="ok">{msg}</span>}
          <button className="btn ghost" onClick={() => save([])}>
            恢复官方统计
          </button>
          <button className="btn" onClick={() => save(list)}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
