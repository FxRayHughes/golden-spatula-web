import { useEffect, useState } from 'react'
import { adminSession, api, type Message } from '../api'
import boardArchive from '../data/board.json'

interface ArchiveMessage {
  nick: string
  content: string
  featured: boolean
  replies: { by: string; text: string }[]
}
const archive = boardArchive as ArchiveMessage[]

const NICK_KEY = 's11.nick'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function AdminTools({ m, onChange }: { m: Message; onChange: () => void }) {
  const [reply, setReply] = useState(m.reply ?? '')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      onChange()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="admin-tools">
      <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="管理员回复（留空可撤回）" maxLength={500} />
      <button className="btn small" disabled={busy} onClick={() => run(() => api.updateMessage(m.id, { reply }))}>
        回复
      </button>
      <button className="btn small ghost" disabled={busy} onClick={() => run(() => api.updateMessage(m.id, { featured: !m.featured }))}>
        {m.featured ? '取消精选' : '设为精选'}
      </button>
      <button
        className="btn small danger"
        disabled={busy}
        onClick={() => confirm(`删除「${m.nick}」的这条留言？`) && run(() => api.deleteMessage(m.id))}
      >
        删除
      </button>
    </div>
  )
}

export default function Board({ online }: { online: boolean | null }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [nick, setNick] = useState(() => {
    try {
      return localStorage.getItem(NICK_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [content, setContent] = useState('')
  const [website, setWebsite] = useState('')
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const isAdmin = !!adminSession.get()

  const load = () => api.messages().then(setMessages).catch(() => {})
  useEffect(() => {
    if (online) load()
  }, [online])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setSending(true)
    try {
      await api.postMessage({ nick, content, website })
      try {
        localStorage.setItem(NICK_KEY, nick)
      } catch {
        /* 无痕模式 */
      }
      setContent('')
      load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const sorted = [...messages].sort((a, b) => Number(b.featured) - Number(a.featured))

  return (
    <>
      <section className="panel">
        <h2>留言板</h2>
        <p className="muted small">反馈新组合、纠错、建议都可以留言。请文明发言，广告和灌水会被删除。</p>
        {online === false ? (
          <p className="notice">留言服务未连接（当前是纯静态部署或后端未启动），暂时只能查看下面的原文档留言存档。</p>
        ) : (
          <form className="form" onSubmit={submit}>
            <div className="form-row">
              <input placeholder="昵称（选填，默认匿名）" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} />
            </div>
            <textarea
              placeholder="说点什么…"
              value={content}
              maxLength={500}
              rows={3}
              onChange={(e) => setContent(e.target.value)}
              required
            />
            {/* 蜜罐：对真人隐藏，机器人会自动填写 */}
            <input className="hp" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden />
            <div className="form-foot">
              <span className="muted small">{content.length}/500</span>
              {err && <span className="error">{err}</span>}
              <button className="btn" disabled={sending || !content.trim()}>
                {sending ? '发送中…' : '发表留言'}
              </button>
            </div>
          </form>
        )}

        {sorted.length > 0 && (
          <ul className="messages">
            {sorted.map((m) => (
              <li key={m.id} className={m.featured ? 'featured' : ''}>
                <div className="msg-head">
                  <b>{m.nick}</b>
                  {m.featured && <span className="badge">精选</span>}
                  <span className="muted small">{fmtTime(m.createdAt)}</span>
                </div>
                <p>{m.content}</p>
                {m.reply && (
                  <div className="reply">
                    <b>管理员 {m.replyBy ?? ''} 回复：</b>
                    {m.reply}
                  </div>
                )}
                {isAdmin && <AdminTools m={m} onChange={load} />}
              </li>
            ))}
          </ul>
        )}
        {online && sorted.length === 0 && <p className="muted">还没有新留言，来抢沙发吧。</p>}
      </section>

      <section className="panel">
        <h2>原文档留言板存档（{archive.length} 条）</h2>
        <p className="muted small">以下留言来自腾讯文档《S11尊者玩法查询工具》的「留言板」，回复分别由 NGA细佬 和 化学必修2 所写。</p>
        <ul className="messages archive">
          {archive.map((m, i) => (
            <li key={i} className={m.featured ? 'featured' : ''}>
              <div className="msg-head">
                <b>{m.nick}</b>
                {m.featured && <span className="badge">精选</span>}
              </div>
              <p>{m.content}</p>
              {m.replies.map((r) => (
                <div key={r.by} className="reply">
                  <b>{r.by}：</b>
                  {r.text}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
