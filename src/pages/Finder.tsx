import { useEffect, useMemo, useState } from 'react'
import { exaltableHeroes } from '../data'
import { bestNextPicks, matchCombos, possibleHeroes } from '../query'
import { comboLabel, go, type Community } from '../community'
import { Avatar, ComboCard, HeroPicker, PlayCard, PlayDetailDialog } from '../components'
import { LayoutDialog } from '../layout'
import { adminSession } from '../api'
import type { ShownPlay } from '../community'

function readSelection(): string[] {
  const h = new URLSearchParams(location.search).get('h')
  const valid = new Set(exaltableHeroes.map((x) => x.name))
  return h ? h.split(',').filter((n) => valid.has(n)) : []
}

export default function Finder({ community }: { community: Community }) {
  const { combos, playsByCombo } = community
  const [isAdmin, setIsAdmin] = useState(!!adminSession.get())
  useEffect(() => adminSession.subscribe(() => setIsAdmin(!!adminSession.get())), [])
  const [editing, setEditing] = useState<ShownPlay | null>(null)
  const [viewing, setViewing] = useState<ShownPlay | null>(null)
  const [selected, setSelected] = useState<string[]>(readSelection)
  const [openCombo, setOpenCombo] = useState<number | null>(null)

  const candidates = useMemo(() => matchCombos(combos, selected), [combos, selected])
  const possible = useMemo(() => possibleHeroes(candidates), [candidates])
  const suggested = useMemo(() => bestNextPicks(candidates, selected), [candidates, selected])

  // 候选只剩一个时直接展开
  const activeId = candidates.length === 1 ? candidates[0].id : openCombo
  const active = candidates.find((c) => c.id === activeId)
  const activePlays = active ? (playsByCombo.get(active.id) ?? []) : []

  useEffect(() => {
    const url = new URL(location.href)
    if (selected.length) url.searchParams.set('h', selected.join(','))
    else url.searchParams.delete('h')
    history.replaceState(null, '', url)
  }, [selected])

  const toggle = (name: string) => {
    setOpenCombo(null)
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))
  }

  let status: string
  if (!selected.length) status = `点选本局看到的尊者棋子，通常选 2 个就能锁定组合（共 ${combos.length} 个组合）`
  else if (!candidates.length) status = '没有匹配的组合：可能选错了，或者这是还没收录的新组合'
  else if (candidates.length === 1) status = `已锁定 #${comboLabel(candidates[0].id)} 号组合`
  else status = `还剩 ${candidates.length} 个候选组合，再确认一个棋子吧`

  return (
    <>
      <section className="panel">
        <div className="status">
          <span>{status}</span>
          {selected.length > 0 && (
            <button className="link-btn" onClick={() => setSelected([])}>
              清空
            </button>
          )}
        </div>
        {selected.length > 0 && (
          <div className="selected">
            {selected.map((h) => (
              <button key={h} className="selected-item" onClick={() => toggle(h)} title="取消选择">
                <Avatar name={h} size={32} />
                {h} ✕
              </button>
            ))}
          </div>
        )}
        {selected.length > 0 && !candidates.length && community.online && (
          <p className="hint-line">
            💡 返场版本可能有原文档没收录的组合。确认本局的全部尊者棋子后，可以
            <button className="link-btn" onClick={() => go(`#/submit?tab=combo&h=${encodeURIComponent(selected.join(','))}`)}>
              提交这个新组合
            </button>
            ，管理员审核通过后大家就能查到。
          </p>
        )}
        {suggested.length > 0 && <p className="hint-line">💡 最能区分剩余组合的棋子：{suggested.join('、')}（选择器中已高亮）</p>}
        <HeroPicker
          heroes={exaltableHeroes}
          selected={selected}
          possible={selected.length ? possible : new Set(exaltableHeroes.map((h) => h.name))}
          suggested={suggested}
          onToggle={toggle}
        />
      </section>

      {selected.length > 0 && candidates.length > 0 && (
        <section className="panel">
          <h2>候选组合</h2>
          <div className="combos">
            {candidates.map((c) => (
              <ComboCard
                key={c.id}
                combo={c}
                selected={selected}
                active={c.id === activeId}
                count={playsByCombo.get(c.id)?.length}
                onOpen={() => setOpenCombo(c.id === openCombo ? null : c.id)}
              />
            ))}
          </div>
        </section>
      )}

      {active && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              #{comboLabel(active.id)} 号组合 · {activePlays.length ? `${activePlays.length} 套玩法` : '暂无收录玩法'}
            </h2>
            {community.online && (
              <button className="btn" onClick={() => go(`#/submit?combo=${active.id}`)}>
                ＋ 为这个组合投稿玩法
              </button>
            )}
          </div>
          {activePlays.length === 0 && <p className="muted">还没有收录这个组合的玩法。</p>}
          <div className="plays">
            {activePlays.map((p, i) => (
              <PlayCard key={p.id ?? p.row} play={p} index={i} onOpen={() => setViewing(p)} onEdit={isAdmin && community.online ? () => setEditing(p) : undefined} />
            ))}
          </div>
        </section>
      )}
      <PlayDetailDialog
        play={viewing}
        onClose={() => setViewing(null)}
        onEdit={isAdmin && community.online && viewing ? () => (setEditing(viewing), setViewing(null)) : undefined}
      />
      <LayoutDialog play={editing} heroRec={community.heroRec} onClose={() => setEditing(null)} onSaved={community.reload} />
    </>
  )
}
