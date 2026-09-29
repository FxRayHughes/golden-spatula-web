import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { allPlays, COST_COLORS, heroByName, heroes as allHeroes, meta, type Combo, type Hero } from './data'
import { comboLabel, HeroRecContext, type ShownPlay } from './community'
import { Board, ItemIcon } from './layout'
import { authorSheets, channelList, docRefs, mainAuthors, techCredits, type Person } from './credits'

export function Avatar({ name, size = 40, mark }: { name: string; size?: number; mark?: 'on' | 'dim' }) {
  const h = heroByName.get(name)
  if (!h) return <span className="chip-text">{name}</span>
  return (
    <span
      className={`avatar ${mark ?? ''}`}
      style={{ width: size, height: size, borderColor: COST_COLORS[h.cost] }}
      title={`${h.name} · ${h.cost}费 · ${h.traits.join(' / ')}`}
    >
      <img src={h.avatar} alt={h.name} loading="lazy" referrerPolicy="no-referrer" />
    </span>
  )
}

export function HeroPicker({
  heroes,
  selected,
  possible,
  suggested,
  onToggle,
}: {
  heroes: Hero[]
  selected: string[]
  possible: Set<string>
  suggested: string[]
  onToggle: (name: string) => void
}) {
  const byCost = [1, 2, 3, 4, 5].map((c) => heroes.filter((h) => h.cost === c)).filter((g) => g.length)
  return (
    <div className="picker">
      {byCost.map((group) => (
        <div key={group[0].cost} className="cost-row">
          <span className="cost-tag" style={{ background: COST_COLORS[group[0].cost] }}>
            {group[0].cost}费
          </span>
          <div className="cost-heroes">
            {group.map((h) => {
              const isOn = selected.includes(h.name)
              const isOff = !isOn && !possible.has(h.name)
              const isHint = suggested.includes(h.name)
              return (
                <button
                  key={h.name}
                  className={`hero ${isOn ? 'on' : ''} ${isOff ? 'off' : ''} ${isHint ? 'hint' : ''}`}
                  style={{ ['--cost' as string]: COST_COLORS[h.cost] }}
                  onClick={() => onToggle(h.name)}
                  disabled={isOff}
                  aria-pressed={isOn}
                  title={isOff ? '与已选棋子不在同一个尊者组合里' : h.traits.join(' / ')}
                >
                  <img src={h.avatar} alt="" referrerPolicy="no-referrer" />
                  <span>{h.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function ComboCard({
  combo,
  selected,
  active,
  count,
  onOpen,
}: {
  combo: Combo
  selected: string[]
  active: boolean
  count?: number
  onOpen: () => void
}) {
  const n = count ?? 0
  return (
    <button type="button" className={`combo ${active ? 'active' : ''}`} onClick={onOpen}>
      <span className="combo-id">#{comboLabel(combo.id)}</span>
      <span className="combo-heroes">
        {combo.heroes.map((h) => (
          <Avatar key={h} name={h} size={34} mark={selected.includes(h) ? 'on' : undefined} />
        ))}
      </span>
      <span className="combo-count">{n ? `${n} 套玩法` : '暂无玩法'}</span>
    </button>
  )
}

// 头像与装备格同宽：3 个装备小格正好铺满头像宽度
const AVATAR = 39
const SLOT = AVATAR / 3

/** 头像下方固定 3 个装备格：优先显示本玩法设置的装备，否则显示该英雄最常用的 3 件（淡显）；都没有时留空占位 */
export function ItemSlots({ hero, own, width = AVATAR }: { hero: string; own?: string[]; width?: number }) {
  const heroRec = useContext(HeroRecContext)
  const fallback = !own?.length
  const ids = (fallback ? heroRec(hero).items : own!).slice(0, 3)
  const slot = width / 3
  return (
    <span className={`item-slots ${fallback ? 'fallback' : ''}`} style={{ width, height: slot }} title={fallback && ids.length ? '灰框：未指定装备，显示官方推荐阵容统计的最常用 3 件' : undefined}>
      {ids.length > 0 &&
        [0, 1, 2].map((i) =>
          ids[i] ? <ItemIcon key={i} id={ids[i]} size={slot} /> : <span key={i} className="slot-empty" style={{ width: slot, height: slot }} />,
        )}
    </span>
  )
}

function Lineup({ label, heroes, tips, items }: { label: string; heroes: string[]; tips: string; items?: Record<string, string[]> }) {
  if (!heroes.length && !tips) return null
  return (
    <div className="lineup">
      <div className="lineup-label">{label}</div>
      {heroes.length > 0 && (
        <div className="lineup-heroes">
          {heroes.map((h, i) => (
            <span key={h + i} className="lineup-hero" style={{ width: AVATAR + 6 }}>
              <Avatar name={h} size={AVATAR} />
              <ItemSlots hero={h} own={items?.[h]} />
              <small>{h}</small>
            </span>
          ))}
        </div>
      )}
      {tips && <p className="tips">{tips}</p>}
    </div>
  )
}

function LinkText({ text }: { text: string }) {
  // 原文档里有网址被连着粘贴两次的情况，先在 http 处断开
  const parts = text
    .replace(/(?<=\S)(https?:\/\/)/g, ' $1')
    .split(/((?:https?:\/\/)?(?:[\w-]+\.)+(?:com|cn|tv|net|cc)[^\s，。]*)/g)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p.startsWith('http') ? p : `https://${p}`} target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

/** 点击卡片后的详情：站位棋盘 + 每个英雄的本玩法装备与全部推荐装备 */
export function PlayDetailDialog({ play, onClose, onEdit }: { play: ShownPlay | null; onClose: () => void; onEdit?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const heroRec = useContext(HeroRecContext)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (play && !d.open) d.showModal()
    if (!play && d.open) d.close()
  }, [play])
  const heroes = play ? [...new Set(play.late.length ? play.late : play.early)] : []
  const hasPos = !!play && Object.keys(play.positions ?? {}).length > 0
  return (
    <dialog ref={ref} className="about layout-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {play && (
        <div className="about-body">
          <header>
            <h2>
              {play.late.length ? '大成阵容' : '过渡阵容'} · 站位与装备 <span className="muted small">· {play.source || '未署名'}</span>
            </h2>
            <button className="icon-btn" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </header>
          {hasPos ? <Board layout={play} size={46} /> : <p className="muted small">这套玩法还没有设置站位。</p>}
          {play.layoutBy && <p className="muted small">站位/装备由 {play.layoutBy} 补充</p>}
          <table className="detail-table">
            <thead>
              <tr>
                <th>英雄</th>
                <th>本玩法装备</th>
                <th>推荐装备</th>
              </tr>
            </thead>
            <tbody>
              {heroes.map((h) => {
                const rec = heroRec(h)
                const own = play.items?.[h] ?? []
                return (
                  <tr key={h}>
                    <td className="dt-hero">
                      <Avatar name={h} size={32} />
                      <span>
                        {h}
                        {play.positions?.[h] && <small className="muted"> · 第{play.positions[h].split(',')[0]}排</small>}
                      </span>
                    </td>
                    <td>{own.length ? own.map((id, i) => <ItemIcon key={id + i} id={id} size={28} />) : <span className="muted small">未指定</span>}</td>
                    <td>
                      {rec.items.length ? (
                        <>
                          {rec.items.map((id) => (
                            <span key={id} className="ip-rec-item">
                              <ItemIcon id={id} size={24} />
                              {rec.counts?.[id] ? <small>{rec.counts[id]}</small> : null}
                            </span>
                          ))}
                          <small className="muted">{rec.source === 'admin' ? ` 管理员 ${rec.updatedBy}` : ' 官方阵容'}</small>
                        </>
                      ) : (
                        <span className="muted small">暂无</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small">装备图标可悬停查看效果与合成方式；数字为官方推荐阵容里的出现次数。</p>
          {onEdit && (
            <div className="form-foot">
              <button className="btn" onClick={onEdit}>
                ✎ 编辑站位/装备
              </button>
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}

export function PlayCard({
  play,
  index,
  actions,
  onEdit,
  onOpen,
}: {
  play: ShownPlay
  index?: number
  actions?: ReactNode
  onEdit?: () => void
  /** 点击卡片空白处时打开详情 */
  onOpen?: () => void
}) {
  const layoutOnEarly = !play.late.length
  const hasPos = Object.keys(play.positions ?? {}).length > 0
  const open = (e: React.MouseEvent) => {
    if (!onOpen || (e.target as HTMLElement).closest('button, a, input, textarea')) return
    onOpen()
  }
  return (
    <article className={`play ${play.community ? 'community' : ''} ${onOpen ? 'clickable' : ''}`} onClick={open} title={onOpen ? '点击查看站位与全部推荐装备' : undefined}>
      <header>
        <span className="play-index">
          {index != null ? `玩法 ${index + 1}` : '玩法预览'}
          {play.community && <span className="badge">社区投稿</span>}
          {hasPos && <span className="badge ghost">有站位</span>}
        </span>
        <span className="play-head-right">
          <span className="play-source">{play.source || '未署名'}</span>
          {onEdit && (
            <button type="button" className="edit-btn" onClick={onEdit} title="编辑站位与装备（管理员）">
              ✎ 站位/装备
            </button>
          )}
        </span>
      </header>
      <Lineup label="过渡阵容" heroes={play.early} tips={play.earlyTips} items={layoutOnEarly ? play.items : undefined} />
      <Lineup label="大成阵容" heroes={play.late} tips={play.lateTips} items={layoutOnEarly ? undefined : play.items} />
      {play.links.length > 0 && (
        <div className="links">
          {play.links.map((l, i) => (
            <div key={i}>
              🔗 <LinkText text={l} />
            </div>
          ))}
        </div>
      )}
      {actions && <footer className="play-actions">{actions}</footer>}
    </article>
  )
}

function PersonList({ people }: { people: Person[] }) {
  return (
    <ul className="people">
      {people.map((p) => (
        <li key={p.name}>
          <b>{p.name}</b>
          {p.note && <span> — {p.note}</span>}
          {p.links?.map((l) =>
            l.url ? (
              <a key={l.label} href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ) : (
              <span key={l.label} className="muted"> （{l.label}）</span>
            ),
          )}
        </li>
      ))}
    </ul>
  )
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const sourceCount = new Map<string, number>()
  for (const p of allPlays) sourceCount.set(p.source || '未署名', (sourceCount.get(p.source || '未署名') ?? 0) + 1)
  const sources = [...sourceCount.entries()].sort((a, b) => b[1] - a[1])

  return (
    <dialog ref={ref} className="about" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="about-body">
        <header>
          <h2>关于</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <p>
          本工具是腾讯文档
          <a href={meta.doc.url} target="_blank" rel="noreferrer">
            《{meta.doc.title}》
          </a>
          的网页版。尊者组合与全部玩法都来自原文档，由原作者和玩家们整理、贡献，本站只负责查询和展示。
          原文档作者在留言板里说过，表格同一时间只能一个人占一个查询页。网页版在各自的浏览器里查询，不用再「占坑」。
        </p>

        <h3>技术鸣谢</h3>
        <PersonList people={techCredits} />

        <h3>提供大量详细玩法（排名不分先后）</h3>
        <PersonList people={mainAuthors} />

        <h3>玩法统计分表作者</h3>
        <p className="tags">
          {authorSheets.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </p>

        <h3>频道列表登记的来源</h3>
        <p className="tags">
          {channelList.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </p>

        <h3>收录玩法的思路来源（共 {allPlays.length} 套）</h3>
        <p className="tags">
          {sources.map(([n, c]) => (
            <span key={n}>
              {n} <em>{c}</em>
            </span>
          ))}
        </p>

        <h3>留言板反馈的玩家（{meta.boardNames.length} 位）</h3>
        <p className="tags small">
          {meta.boardNames.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </p>

        <h3>数据来源</h3>
        <ul className="people">
          <li>
            组合与玩法：
            <a href={meta.doc.url} target="_blank" rel="noreferrer">
              腾讯文档《{meta.doc.title}》
            </a>
            （文档最后更新 {meta.doc.lastModified.slice(0, 10)}，本站同步于 {meta.syncedAt.slice(0, 10)}）
          </li>
          <li>
            英雄头像与羁绊：
            <a href="https://jcc.qq.com/" target="_blank" rel="noreferrer">
              金铲铲之战官方资料库
            </a>
            （画之灵 {meta.jcc.version}）
          </li>
          {docRefs.map((r) => (
            <li key={r.url}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.label}
              </a>
            </li>
          ))}
        </ul>

        <p className="muted small">
          游戏素材版权归腾讯 / Riot Games 所有。本站为非商业的玩家工具。如果你是原文档的作者，希望修改署名或下架，请联系站点维护者。
        </p>
      </div>
    </dialog>
  )
}

/** 阵容编辑用的英雄选择：按点选顺序记录，可按名字 / 羁绊筛选 */
export function LineupPicker({
  value,
  onChange,
  max,
  pool = allHeroes,
}: {
  value: string[]
  onChange: (v: string[]) => void
  max: number
  pool?: Hero[]
}) {
  const [q, setQ] = useState('')
  const shown = pool.filter((h) => !q || h.name.includes(q) || h.traits.some((t) => t.includes(q)))
  const toggle = (n: string) =>
    onChange(value.includes(n) ? value.filter((x) => x !== n) : value.length < max ? [...value, n] : value)
  return (
    <div className="lineup-picker">
      <div className="lp-selected">
        {value.length === 0 && <span className="muted small">还没选（最多 {max} 个），点下方头像添加</span>}
        {value.map((n) => (
          <button type="button" key={n} className="selected-item" onClick={() => toggle(n)} title="移除">
            <Avatar name={n} size={28} />
            {n} ✕
          </button>
        ))}
        {value.length > 0 && (
          <span className="muted small">
            {value.length}/{max}
          </span>
        )}
      </div>
      <input
        className="lp-search"
        placeholder="搜索英雄或羁绊，如：天龙、莉莉娅"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="lp-grid">
        {shown.map((h) => {
          const on = value.includes(h.name)
          return (
            <button
              type="button"
              key={h.name}
              className={`lp-hero ${on ? 'on' : ''}`}
              style={{ ['--cost' as string]: COST_COLORS[h.cost] }}
              onClick={() => toggle(h.name)}
              disabled={!on && value.length >= max}
              title={`${h.cost}费 · ${h.traits.join(' / ')}`}
            >
              <img src={h.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
              <span>{h.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
