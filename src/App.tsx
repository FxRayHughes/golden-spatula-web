import { useEffect, useState } from 'react'
import { meta } from './data'
import { adminSession, api } from './api'
import { go, HeroRecContext, useCommunity, useRoute } from './community'
import { AboutDialog } from './components'
import Finder from './pages/Finder'
import Board from './pages/Board'
import Submit from './pages/Submit'
import Admin from './pages/Admin'
import Items from './pages/Items'

const NAV = [
  { page: 'finder', label: '查询' },
  { page: 'items', label: '装备' },
  { page: 'board', label: '留言板' },
  { page: 'submit', label: '投稿' },
]

export default function App() {
  const [about, setAbout] = useState(false)
  const community = useCommunity()
  const { page, params } = useRoute()
  const [session, setSession] = useState(adminSession.get)
  useEffect(() => adminSession.subscribe(() => setSession(adminSession.get())), [])
  const nav = session ? [...NAV, { page: 'admin', label: '管理' }] : NAV

  const logout = async () => {
    await api.logout().catch(() => {})
    adminSession.clear()
    if (page === 'admin') go('#/')
  }

  return (
    <HeroRecContext.Provider value={community.heroRec}>
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src={meta.exalted.icon ?? ''} alt="" referrerPolicy="no-referrer" />
          <div>
            <h1>S11 尊者配对</h1>
            <p>画之灵 · 根据尊者棋子找组合与玩法</p>
          </div>
        </div>
        <div className="top-actions">
          {session ? (
            <>
              <button className="user-btn" onClick={() => go('#/admin')} title="进入管理后台">
                <span className="hide-sm">管理后台 · </span>
                {session.admin.name}
              </button>
              <button className="link-btn small" onClick={logout}>
                退出
              </button>
            </>
          ) : (
            <button className="user-btn" onClick={() => go('#/admin')}>
              登录
            </button>
          )}
          <button className="about-btn" onClick={() => setAbout(true)}>
            关于
          </button>
        </div>
      </header>

      <nav className="tabs">
        {nav.map((n) => (
          <button key={n.page} className={page === n.page ? 'on' : ''} onClick={() => go(`#/${n.page === 'finder' ? '' : n.page}`)}>
            {n.label}
          </button>
        ))}
      </nav>

      {page === 'items' ? (
        <Items community={community} />
      ) : page === 'board' ? (
        <Board online={community.online} />
      ) : page === 'submit' ? (
        <Submit community={community} params={params} />
      ) : page === 'admin' ? (
        <Admin community={community} />
      ) : (
        <Finder community={community} />
      )}

      <footer className="foot">
        数据来自腾讯文档《{meta.doc.title}》与金铲铲官方资料库 ·{' '}
        <button className="link-btn" onClick={() => setAbout(true)}>
          作者与鸣谢
        </button>
      </footer>

      <AboutDialog open={about} onClose={() => setAbout(false)} />
    </div>
    </HeroRecContext.Provider>
  )
}
