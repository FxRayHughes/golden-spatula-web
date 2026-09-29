import { useEffect, useState } from 'react'
import { adminSession, api, type AdminInfo, type CommunityCombo, type CommunityPlay, type ReviewStatus } from '../api'
import { comboLabel, go, toShown, type Community } from '../community'
import { combos as baseCombos } from '../data'
import { Avatar, PlayCard } from '../components'
import { HeroItemsEditor } from './Items'
import { STATUS_TEXT } from './Submit'

const STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected']
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
const fmt = (iso: string) => new Date(iso).toLocaleString()

function Login({ onOk }: { onOk: () => void }) {
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      adminSession.set(await api.login(name.trim(), pw))
      onOk()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <section className="panel">
      <h2>管理员登录</h2>
      <form className="form narrow" onSubmit={login}>
        <input placeholder="用户名" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoFocus />
        <input type="password" placeholder="口令" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        <button className="btn">登录</button>
        {err && <p className="error">{err}</p>}
        <p className="muted small">站长账号由部署时的 ADMIN_USER / ADMIN_PASSWORD 创建；其他管理员由站长在后台添加。</p>
      </form>
    </section>
  )
}

async function act(fn: () => Promise<unknown>, after: () => void) {
  try {
    await fn()
    after()
  } catch (e) {
    alert((e as Error).message)
  }
}

function StatusTabs({ value, onChange, counts }: { value: ReviewStatus; onChange: (s: ReviewStatus) => void; counts: Record<ReviewStatus, number> }) {
  return (
    <div className="seg">
      {STATUSES.map((s) => (
        <button key={s} className={value === s ? 'on' : ''} onClick={() => onChange(s)}>
          {STATUS_TEXT[s]}（{counts[s]}）
        </button>
      ))}
    </div>
  )
}

function countBy<T extends { status: ReviewStatus }>(list: T[]) {
  return Object.fromEntries(STATUSES.map((s) => [s, list.filter((x) => x.status === s).length])) as Record<ReviewStatus, number>
}

function ComboReview({ combos, reload }: { combos: CommunityCombo[]; reload: () => void }) {
  const [tab, setTab] = useState<ReviewStatus>('pending')
  const shown = combos.filter((c) => c.status === tab).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return (
    <>
      <StatusTabs value={tab} onChange={setTab} counts={countBy(combos)} />
      {shown.length === 0 && <p className="muted">没有{STATUS_TEXT[tab]}的组合。</p>}
      <ul className="review-list">
        {shown.map((c) => {
          const base = baseCombos.find((b) => sameSet(b.heroes, c.heroes))
          const other = combos.find((o) => o.subId !== c.subId && o.status === 'approved' && sameSet(o.heroes, c.heroes))
          return (
            <li key={c.subId}>
              <div className="review-head">
                <b>{c.id ? `#${comboLabel(c.id)}` : '待编号'}</b>
                <span className="muted small">
                  登记人 {c.source} · {fmt(c.createdAt)}
                  {c.reviewedBy && ` · 审核：${c.reviewedBy}`}
                </span>
              </div>
              <div className="review-heroes">
                {c.heroes.map((h) => (
                  <span key={h} className="lineup-hero">
                    <Avatar name={h} size={36} />
                    <small>{h}</small>
                  </span>
                ))}
              </div>
              {c.note && <p className="tips">{c.note}</p>}
              {(base || other) && <p className="error">与已收录的 #{base ? base.id : comboLabel(other!.id!)} 重复</p>}
              <div className="play-actions">
                {c.status !== 'approved' && (
                  <button className="btn small" onClick={() => act(() => api.setComboStatus(c.subId, 'approved'), reload)}>
                    通过并编号
                  </button>
                )}
                {c.status !== 'rejected' && (
                  <button className="btn small ghost" onClick={() => act(() => api.setComboStatus(c.subId, 'rejected'), reload)}>
                    {c.status === 'approved' ? '下架' : '不通过'}
                  </button>
                )}
                <button className="btn small ghost" onClick={() => go(`#/submit?tab=combo&edit=${c.subId}`)}>
                  编辑
                </button>
                <button className="btn small danger" onClick={() => confirm('删除这条组合登记？') && act(() => api.deleteCombo(c.subId), reload)}>
                  删除
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function PlayReview({ plays, reload }: { plays: CommunityPlay[]; reload: () => void }) {
  const [tab, setTab] = useState<ReviewStatus>('pending')
  const shown = plays.filter((p) => p.status === tab).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return (
    <>
      <StatusTabs value={tab} onChange={setTab} counts={countBy(plays)} />
      {shown.length === 0 && <p className="muted">没有{STATUS_TEXT[tab]}的玩法。</p>}
      <div className="plays">
        {shown.map((p) => {
          const dup = p.newCombo && baseCombos.find((c) => sameSet(c.heroes, p.newCombo!))
          return (
            <div key={p.id} className="admin-item">
              <div className="admin-meta">
                {p.comboId ? `组合 #${comboLabel(p.comboId)}` : `附带新组合：${p.newCombo?.join('、')}`}
                {dup && <span className="error">（与已收录 #{dup.id} 相同）</span>}
                <span className="muted small">
                  {' '}
                  · {fmt(p.updatedAt)}
                  {p.reviewedBy && ` · 审核：${p.reviewedBy}`}
                </span>
              </div>
              <PlayCard
                play={toShown(p)}
                actions={
                  <>
                    {p.status !== 'approved' && (
                      <button className="btn small" onClick={() => act(() => api.setPlayStatus(p.id, 'approved'), reload)}>
                        通过
                      </button>
                    )}
                    {p.status !== 'rejected' && (
                      <button className="btn small ghost" onClick={() => act(() => api.setPlayStatus(p.id, 'rejected'), reload)}>
                        {p.status === 'approved' ? '下架' : '不通过'}
                      </button>
                    )}
                    <button className="btn small ghost" onClick={() => go(`#/submit?tab=play&edit=${p.id}`)}>
                      编辑
                    </button>
                    <button className="btn small danger" onClick={() => confirm('删除这条投稿？') && act(() => api.deletePlay(p.id), reload)}>
                      删除
                    </button>
                  </>
                }
              />
            </div>
          )
        })}
      </div>
    </>
  )
}

function AdminAccounts({ me }: { me: AdminInfo }) {
  const [list, setList] = useState<AdminInfo[]>([])
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const load = () => api.admins().then(setList).catch((e) => setErr(e.message))
  useEffect(() => {
    load()
  }, [])
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      await api.createAdmin(name.trim(), pw)
      setName('')
      setPw('')
      load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <>
      <table className="admin-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>身份</th>
            <th>创建</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td>
                {a.name}
                {a.id === me.id && <span className="muted small">（你）</span>}
              </td>
              <td>{a.role === 'owner' ? '站长' : '管理员'}</td>
              <td className="muted small">
                {a.createdBy} · {new Date(a.createdAt).toLocaleDateString()}
              </td>
              <td>
                {a.role !== 'owner' && (
                  <>
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        const p = prompt(`为「${a.name}」设置新口令（至少 10 位）`)
                        if (p) act(() => api.resetAdminPassword(a.id, p), () => alert('已重置，该管理员需要用新口令重新登录'))
                      }}
                    >
                      重置口令
                    </button>{' '}
                    <button className="btn small danger" onClick={() => confirm(`删除管理员「${a.name}」？`) && act(() => api.deleteAdmin(a.id), load)}>
                      删除
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="form-row add-admin" onSubmit={add}>
        <input placeholder="新管理员用户名" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        <input type="password" placeholder="初始口令（至少 10 位）" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <button className="btn" disabled={!name.trim() || pw.length < 10}>
          添加管理员
        </button>
      </form>
      {err && <p className="error">{err}</p>}
      <p className="muted small">把用户名和初始口令私下发给对方，对方登录后可在「我的账号」里自行修改口令。</p>
    </>
  )
}

function MyAccount({ me }: { me: AdminInfo }) {
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')
  if (me.role === 'owner') return <p className="muted">站长口令由环境变量 ADMIN_PASSWORD 管理，修改后重启服务即可生效（其他设备上的站长登录会失效）。</p>
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.changePassword(old, next)
      setOld('')
      setNext('')
      setMsg('口令已修改，其他设备上的登录已失效。')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  return (
    <form className="form narrow" onSubmit={save}>
      <input type="password" placeholder="原口令" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" />
      <input type="password" placeholder="新口令（至少 10 位）" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      <button className="btn" disabled={!old || next.length < 10}>
        修改口令
      </button>
      {msg && <p className="muted small">{msg}</p>}
    </form>
  )
}

type Tab = 'combos' | 'plays' | 'items' | 'admins' | 'account'

export default function Admin({ community }: { community: Community }) {
  const [me, setMe] = useState<AdminInfo | null>(adminSession.get()?.admin ?? null)
  const [data, setData] = useState<{ plays: CommunityPlay[]; combos: CommunityCombo[] }>({ plays: [], combos: [] })
  const [tab, setTab] = useState<Tab>('combos')

  const reload = () => {
    api
      .review()
      .then(setData)
      .catch(() => setMe(adminSession.get()?.admin ?? null))
    community.reload()
  }
  // 顶部「退出」或其他标签页登录/退出时同步
  useEffect(() => adminSession.subscribe(() => setMe(adminSession.get()?.admin ?? null)), [])
  useEffect(() => {
    if (!me) return
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null))
  }, [me?.id])
  // 切换页签时刷新，能看到别人刚提交的投稿
  useEffect(() => {
    if (me) reload()
  }, [me?.id, tab])

  if (!me) return <Login onOk={() => setMe(adminSession.get()!.admin)} />

  const logout = async () => {
    await api.logout().catch(() => {})
    adminSession.clear()
    setMe(null)
  }
  const pending = (l: { status: ReviewStatus }[]) => l.filter((x) => x.status === 'pending').length
  const tabs: { key: Tab; label: string }[] = [
    { key: 'combos', label: `组合审核${pending(data.combos) ? `（${pending(data.combos)}）` : ''}` },
    { key: 'plays', label: `玩法审核${pending(data.plays) ? `（${pending(data.plays)}）` : ''}` },
    { key: 'items', label: '装备推荐' },
    ...(me.role === 'owner' ? [{ key: 'admins' as Tab, label: '管理员' }] : []),
    { key: 'account', label: '我的账号' },
  ]

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          管理后台 <span className="muted small">· {me.name}（{me.role === 'owner' ? '站长' : '管理员'}）</span>
        </h2>
        <span>
          <button className="btn small" onClick={() => go('#/submit?tab=combo')}>
            ＋ 录入组合
          </button>{' '}
          <button className="btn small" onClick={() => go('#/submit?tab=play')}>
            ＋ 录入玩法
          </button>{' '}
          <button className="btn small ghost" onClick={reload}>
            刷新
          </button>{' '}
          <button className="btn small ghost" onClick={logout}>
            退出
          </button>
        </span>
      </div>
      <p className="muted small">
        留言的回复、精选、删除在「留言板」页面操作；阵容的站位与装备在「查询」页点玩法卡片右上角的「✎ 站位/装备」编辑。每次操作都会记录管理员。
      </p>
      <nav className="tabs sub">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'combos' && <ComboReview combos={data.combos} reload={reload} />}
      {tab === 'plays' && <PlayReview plays={data.plays} reload={reload} />}
      {tab === 'items' && <HeroItemsEditor community={community} />}
      {tab === 'admins' && <AdminAccounts me={me} />}
      {tab === 'account' && <MyAccount me={me} />}
    </section>
  )
}
