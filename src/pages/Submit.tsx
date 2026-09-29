import { useEffect, useMemo, useState } from 'react'
import {
  adminSession,
  api,
  ApiError,
  mySubmissions,
  type CommunityCombo,
  type CommunityPlay,
  type ComboInput,
  type PlayInput,
  type ReviewStatus,
} from '../api'
import { exaltableHeroes } from '../data'
import { matchCombos } from '../query'
import { comboLabel, go, toShown, type Community } from '../community'
import { Avatar, ComboCard, HeroPicker, LineupPicker, PlayCard } from '../components'
import { LayoutEditor } from '../layout'

export const STATUS_TEXT: Record<ReviewStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过',
}

const SOURCE_KEY = 's11.source'
const exaltableNames = new Set(exaltableHeroes.map((h) => h.name))

function savedSource() {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveSource(s: string) {
  try {
    localStorage.setItem(SOURCE_KEY, s)
  } catch {
    /* 无痕模式 */
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
const parseHeroes = (s: string | null) => (s ? s.split(',').filter((n) => exaltableNames.has(n)) : [])

// ======================= 登记新组合 =======================

function ComboForm({ community, params, onSaved }: { community: Community; params: URLSearchParams; onSaved: () => void }) {
  const editId = params.get('edit')
  const isAdmin = !!adminSession.get()
  const [form, setForm] = useState<ComboInput>({ heroes: [], source: '', note: '' })
  const [editing, setEditing] = useState<CommunityCombo | null>(null)
  const [publish, setPublish] = useState(true)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setErr('')
    setDone('')
    if (editId) {
      api
        .getCombo(editId)
        .then((c) => {
          setEditing(c)
          setForm({ heroes: c.heroes, source: c.source, note: c.note ?? '' })
        })
        .catch((e) => setErr(`无法编辑：${e.message}`))
      return
    }
    setEditing(null)
    setForm({ heroes: parseHeroes(params.get('h')), source: savedSource(), note: '' })
  }, [editId, params.toString()])

  const exact = community.combos.find((c) => sameSet(c.heroes, form.heroes))
  const containing = form.heroes.length >= 2 && !exact ? matchCombos(community.combos, form.heroes) : []
  const locked = editing?.status === 'approved' && !isAdmin

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setDone('')
    setBusy(true)
    saveSource(form.source)
    try {
      if (editing) {
        setEditing(await api.updateCombo(editing.subId, form))
        setDone(isAdmin ? '已保存。' : '已保存，等待管理员审核。')
      } else {
        const { combo, editKey } = await api.createCombo(form)
        mySubmissions.add({ kind: 'combo', id: combo.subId, key: editKey })
        let msg = '已提交，管理员审核通过后就会出现在查询里。'
        if (isAdmin && publish) {
          const ok = await api.setComboStatus(combo.subId, 'approved')
          msg = `已收录为 #${comboLabel(ok.id!)} 号组合。`
        }
        setForm({ heroes: [], source: form.source, note: '' })
        setDone(msg)
      }
      onSaved()
      community.reload()
    } catch (e) {
      const ae = e as ApiError
      setErr(ae.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!editing || !confirm('确定删除这条组合登记？')) return
    try {
      await api.deleteCombo(editing.subId)
      mySubmissions.remove(editing.subId)
      community.reload()
      go(isAdmin ? '#/admin' : '#/submit?tab=combo')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <form className="form editor" onSubmit={submit}>
      {editing && (
        <p className="notice">
          正在编辑 · {STATUS_TEXT[editing.status]}
          {editing.id ? ` · #${comboLabel(editing.id)}` : ''}
          {editing.reviewedBy ? ` · 审核人 ${editing.reviewedBy}` : ''}
          {locked && ' · 已通过审核的组合不能再修改，如有错误请在留言板反馈'}
        </p>
      )}
      <fieldset className="step" disabled={locked}>
        <legend>① 本局的全部尊者棋子</legend>
        <p className="muted small">
          原文档收录了 60 个组合，返场版本可能有没收录的新组合。开局后在商店/棋子上看带「尊者」标记的弈子，一般是 5~6 个。
          拥有 3 个羁绊的弈子不会成为尊者，所以不在列表里。
        </p>
        <LineupPicker value={form.heroes} onChange={(heroes) => setForm({ ...form, heroes })} max={6} pool={exaltableHeroes} />
        {exact && (
          <p className="hint-line">
            这就是已收录的 #{comboLabel(exact.id)} 号组合，不需要再登记。
            <button type="button" className="link-btn" onClick={() => go(`#/submit?tab=play&combo=${exact.id}`)}>
              为它投稿玩法
            </button>
          </p>
        )}
        {containing.length > 0 && (
          <div className="hint-box">
            <p className="hint-line">你选的棋子包含在下面的已收录组合里，确认不是其中之一吗？</p>
            <div className="combos">
              {containing.slice(0, 4).map((c) => (
                <ComboCard key={c.id} combo={c} selected={form.heroes} active={false} count={community.playsByCombo.get(c.id)?.length} onOpen={() => go(`#/?h=${encodeURIComponent(form.heroes.join(','))}`)} />
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="step" disabled={locked}>
        <legend>② 登记信息</legend>
        <div className="form-row">
          <label>
            登记人 *
            <input placeholder="你的昵称" value={form.source} maxLength={20} required onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </label>
        </div>
        <label className="muted small">
          备注（选填）
          <textarea
            rows={2}
            maxLength={300}
            placeholder="例如：9/29 排位实战遇到；对局截图 / 录像链接"
            value={form.note ?? ''}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
      </fieldset>

      <div className="form-foot">
        {!editing && isAdmin && (
          <label className="check">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> 直接收录
          </label>
        )}
        {err && <span className="error">{err}</span>}
        {done && <span className="ok">{done}</span>}
        {editing && (isAdmin || editing.status !== 'approved') && (
          <button type="button" className="btn danger" onClick={remove}>
            删除
          </button>
        )}
        <button className="btn" disabled={busy || locked || form.heroes.length < 3 || !!exact}>
          {busy ? '提交中…' : editing ? '保存修改' : '提交组合'}
        </button>
      </div>
    </form>
  )
}

// ======================= 投稿玩法 =======================

function emptyPlay(): PlayInput {
  return { source: savedSource(), early: [], earlyTips: '', late: [], lateTips: '', links: ['', ''] }
}

function ComboStep({ community, form, setForm }: { community: Community; form: PlayInput; setForm: (f: PlayInput) => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>(form.newCombo?.length ? 'new' : 'existing')
  const [filter, setFilter] = useState<string[]>([])
  const candidates = useMemo(() => matchCombos(community.combos, filter), [community.combos, filter])
  const chosen = community.combos.find((c) => c.id === form.comboId)
  const newCombo = form.newCombo ?? []
  const duplicate = newCombo.length >= 3 ? community.combos.find((c) => sameSet(c.heroes, newCombo)) : undefined

  useEffect(() => setMode(form.newCombo?.length ? 'new' : 'existing'), [form.newCombo?.length])

  const switchMode = (m: 'existing' | 'new') => {
    setMode(m)
    setForm(m === 'new' ? { ...form, comboId: undefined, newCombo } : { ...form, newCombo: undefined })
  }

  return (
    <fieldset className="step">
      <legend>① 尊者组合</legend>
      <div className="seg">
        <button type="button" className={mode === 'existing' ? 'on' : ''} onClick={() => switchMode('existing')}>
          已收录的组合
        </button>
        <button type="button" className={mode === 'new' ? 'on' : ''} onClick={() => switchMode('new')}>
          未收录的新组合
        </button>
      </div>

      {mode === 'existing' ? (
        chosen ? (
          <div className="chosen">
            <ComboCard combo={chosen} selected={[]} active count={community.playsByCombo.get(chosen.id)?.length} onOpen={() => {}} />
            <button type="button" className="link-btn" onClick={() => setForm({ ...form, comboId: undefined })}>
              换一个
            </button>
          </div>
        ) : (
          <>
            <p className="muted small">点几个这套组合里的尊者棋子来筛选，然后在下面点选组合。</p>
            <HeroPicker
              heroes={exaltableHeroes}
              selected={filter}
              possible={filter.length ? new Set(candidates.flatMap((c) => c.heroes)) : exaltableNames}
              suggested={[]}
              onToggle={(n) => setFilter((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))}
            />
            {filter.length > 0 && (
              <div className="combos" style={{ marginTop: 10 }}>
                {candidates.map((c) => (
                  <ComboCard
                    key={c.id}
                    combo={c}
                    selected={filter}
                    active={false}
                    count={community.playsByCombo.get(c.id)?.length}
                    onOpen={() => setForm({ ...form, comboId: c.id, newCombo: undefined })}
                  />
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <>
          <p className="muted small">组合会随这套玩法一起审核；只想登记组合的话，用上方「登记新组合」更快。</p>
          <LineupPicker value={newCombo} onChange={(v) => setForm({ ...form, newCombo: v })} max={6} pool={exaltableHeroes} />
          {duplicate && (
            <p className="hint-line">
              这就是已收录的 #{comboLabel(duplicate.id)} 号组合，
              <button type="button" className="link-btn" onClick={() => setForm({ ...form, comboId: duplicate.id, newCombo: undefined })}>
                直接用它
              </button>
            </p>
          )}
        </>
      )}
    </fieldset>
  )
}

function PlayForm({ community, params, onSaved }: { community: Community; params: URLSearchParams; onSaved: () => void }) {
  const editId = params.get('edit')
  const isAdmin = !!adminSession.get()
  const [form, setForm] = useState<PlayInput>(emptyPlay)
  const [editing, setEditing] = useState<CommunityPlay | null>(null)
  const [publish, setPublish] = useState(true)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setErr('')
    setDone('')
    if (editId) {
      api
        .getPlay(editId)
        .then((p) => {
          setEditing(p)
          setForm({
            comboId: p.comboId,
            newCombo: p.newCombo,
            source: p.source,
            early: p.early,
            earlyTips: p.earlyTips,
            late: p.late,
            lateTips: p.lateTips,
            links: [...p.links, '', ''].slice(0, Math.max(2, p.links.length)),
            items: p.items,
            positions: p.positions,
          })
        })
        .catch((e) => setErr(`无法编辑：${e.message}`))
      return
    }
    setEditing(null)
    const fresh = parseHeroes(params.get('new'))
    setForm({ ...emptyPlay(), comboId: Number(params.get('combo')) || undefined, newCombo: fresh.length ? fresh : undefined })
  }, [editId, params.toString()])

  const set = <K extends keyof PlayInput>(k: K, v: PlayInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const preview = toShown({ ...form, links: form.links.filter((l) => l.trim()), id: 'preview', status: 'pending', createdAt: '', updatedAt: '' })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setDone('')
    const body = { ...form, links: form.links.filter((l) => l.trim()) }
    setBusy(true)
    saveSource(form.source)
    try {
      if (editing) {
        setEditing(await api.updatePlay(editing.id, body))
        setDone(isAdmin ? '已保存。' : '已保存，修改后的内容会重新进入审核。')
      } else {
        const { play, editKey } = await api.createPlay(body)
        mySubmissions.add({ kind: 'play', id: play.id, key: editKey })
        if (isAdmin && publish) await api.setPlayStatus(play.id, 'approved')
        setForm({ ...emptyPlay(), comboId: play.comboId ?? form.comboId })
        setDone(isAdmin && publish ? '已发布。可以继续录入同一组合的下一套玩法。' : '投稿成功，审核通过后会出现在查询结果里。')
      }
      onSaved()
      community.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!editing || !confirm('确定删除这条投稿？删除后无法恢复。')) return
    try {
      await api.deletePlay(editing.id)
      mySubmissions.remove(editing.id)
      community.reload()
      go(isAdmin ? '#/admin' : '#/submit?tab=play')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (editId && !editing) return err ? <p className="error">{err}</p> : <p className="muted">加载中…</p>

  return (
    <form className="form editor" onSubmit={submit}>
      {editing && (
        <p className="notice">
          正在编辑 · {STATUS_TEXT[editing.status]}
          {editing.reviewedBy ? ` · 审核人 ${editing.reviewedBy}` : ''}
          {!isAdmin && editing.status === 'approved' && ' · 保存后需要重新审核'}
        </p>
      )}
      <ComboStep community={community} form={form} setForm={setForm} />

      <fieldset className="step">
        <legend>② 过渡阵容</legend>
        <LineupPicker value={form.early} onChange={(v) => set('early', v)} max={10} />
        <textarea placeholder="过渡要点：运营节奏、装备、何时转型…" rows={2} maxLength={1000} value={form.earlyTips} onChange={(e) => set('earlyTips', e.target.value)} />
      </fieldset>

      <fieldset className="step">
        <legend>③ 大成阵容</legend>
        <LineupPicker value={form.late} onChange={(v) => set('late', v)} max={12} />
        <textarea placeholder="大成要点：主C / 主坦、站位、替换思路…" rows={2} maxLength={1000} value={form.lateTips} onChange={(e) => set('lateTips', e.target.value)} />
      </fieldset>

      <fieldset className="step">
        <legend>④ 站位与装备（选填）</legend>
        <LayoutEditor
          heroes={form.late.length ? form.late : form.early}
          value={{ items: form.items, positions: form.positions }}
          onChange={(l) => setForm((f) => ({ ...f, items: l.items, positions: l.positions }))}
          heroRec={community.heroRec}
        />
      </fieldset>

      <fieldset className="step">
        <legend>⑤ 来源与链接</legend>
        <div className="form-row">
          <label>
            思路来源 *
            <input placeholder="你的昵称或 UP 主名" value={form.source} maxLength={20} required onChange={(e) => set('source', e.target.value)} />
          </label>
        </div>
        {form.links.map((l, i) => (
          <div className="form-row" key={i}>
            <label>
              相关链接{i + 1}
              <input
                placeholder="视频 / 帖子 / 阵容码，选填"
                value={l}
                maxLength={300}
                onChange={(e) => set('links', form.links.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset className="step">
        <legend>预览</legend>
        <PlayCard play={preview} />
      </fieldset>

      <div className="form-foot">
        {!editing && isAdmin && (
          <label className="check">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> 直接发布
          </label>
        )}
        {err && <span className="error">{err}</span>}
        {done && <span className="ok">{done}</span>}
        {editing && (
          <button type="button" className="btn danger" onClick={remove}>
            删除
          </button>
        )}
        <button className="btn" disabled={busy}>
          {busy ? '提交中…' : editing ? '保存修改' : '提交投稿'}
        </button>
      </div>
    </form>
  )
}

// ======================= 我的投稿 =======================

type MyItem =
  | { kind: 'play'; id: string; data: CommunityPlay }
  | { kind: 'combo'; id: string; data: CommunityCombo }
  | { kind: 'gone'; id: string }

function MySubmissions({ refresh }: { refresh: string }) {
  const [items, setItems] = useState<MyItem[]>([])
  useEffect(() => {
    Promise.all(
      mySubmissions.list().map((m): Promise<MyItem> =>
        (m.kind === 'combo'
          ? api.getCombo(m.id).then((data) => ({ kind: 'combo' as const, id: m.id, data }))
          : api.getPlay(m.id).then((data) => ({ kind: 'play' as const, id: m.id, data }))
        ).catch(() => ({ kind: 'gone', id: m.id })),
      ),
    ).then(setItems)
  }, [refresh])
  if (!items.length) return null
  const forget = (id: string) => {
    mySubmissions.remove(id)
    setItems((s) => s.filter((x) => x.id !== id))
  }
  return (
    <section className="panel">
      <h2>我的投稿（保存在本浏览器）</h2>
      <p className="muted small">编辑口令只保存在这台设备的浏览器里，清除浏览器数据或换设备后就不能再修改了。</p>
      <ul className="my-list">
        {items.map((it) =>
          it.kind === 'gone' ? (
            <li key={it.id} className="muted">
              一条投稿已被删除
              <button className="link-btn" onClick={() => forget(it.id)}>
                移除记录
              </button>
            </li>
          ) : (
            <li key={it.id}>
              <span className={`status-tag ${it.data.status}`}>{STATUS_TEXT[it.data.status]}</span>
              {it.kind === 'combo' ? (
                <>
                  <span className="my-combo">组合{it.data.id ? ` #${comboLabel(it.data.id)}` : ''}</span>
                  <span className="my-heroes">
                    {it.data.heroes.map((h) => (
                      <Avatar key={h} name={h} size={24} />
                    ))}
                  </span>
                </>
              ) : (
                <>
                  <span className="my-combo">玩法 · {it.data.comboId ? `#${comboLabel(it.data.comboId)}` : '新组合'}</span>
                  <span className="my-heroes">
                    {(it.data.late.length ? it.data.late : it.data.early).slice(0, 6).map((h) => (
                      <Avatar key={h} name={h} size={24} />
                    ))}
                  </span>
                </>
              )}
              {it.data.reviewedBy && <span className="muted small">审核：{it.data.reviewedBy}</span>}
              <button className="link-btn" onClick={() => go(`#/submit?tab=${it.kind}&edit=${it.id}`)}>
                {it.kind === 'combo' && it.data.status === 'approved' ? '查看' : '编辑'}
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  )
}

// ======================= 页面 =======================

export default function Submit({ community, params }: { community: Community; params: URLSearchParams }) {
  const tab = params.get('tab') ?? (params.get('h') ? 'combo' : 'play')
  const [saved, setSaved] = useState(0)

  if (community.online === false)
    return (
      <section className="panel">
        <h2>投稿</h2>
        <p className="notice">投稿服务未连接（当前是纯静态部署或后端未启动），暂时不能投稿。</p>
      </section>
    )

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div className="seg" style={{ margin: 0 }}>
            <button className={tab === 'combo' ? 'on' : ''} onClick={() => go('#/submit?tab=combo')}>
              登记新组合
            </button>
            <button className={tab === 'play' ? 'on' : ''} onClick={() => go('#/submit?tab=play')}>
              投稿玩法
            </button>
          </div>
          {params.get('edit') && (
            <button className="link-btn" onClick={() => go(`#/submit?tab=${tab}`)}>
              新建一条
            </button>
          )}
        </div>
        <p className="muted small">
          和原文档「公开表格」一样，登记新发现的尊者组合或好用的变阵，帮助更多玩家。
          {adminSession.get() ? '当前是管理员身份：可直接收录 / 发布，不受频率限制。' : '所有投稿经管理员审核后公开。'}
        </p>
        {tab === 'combo' ? (
          <ComboForm community={community} params={params} onSaved={() => setSaved((n) => n + 1)} />
        ) : (
          <PlayForm community={community} params={params} onSaved={() => setSaved((n) => n + 1)} />
        )}
      </section>
      <MySubmissions refresh={`${saved}-${community.combos.length}-${params.toString()}`} />
    </>
  )
}
