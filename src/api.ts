import type { Layout, Play } from './data'

export interface Message {
  id: string
  nick: string
  content: string
  reply?: string
  replyBy?: string
  featured: boolean
  createdAt: string
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

/** 社区投稿的玩法，字段与原文档玩法一致 */
export interface CommunityPlay extends Omit<Play, 'row' | 'comboId'> {
  id: string
  comboId?: number
  newCombo?: string[]
  status: ReviewStatus
  reviewedBy?: string
  createdAt: string
  updatedAt: string
}

export type PlayInput = Pick<
  CommunityPlay,
  'comboId' | 'newCombo' | 'source' | 'early' | 'earlyTips' | 'late' | 'lateTips' | 'links' | 'items' | 'positions'
>

/** 社区登记的尊者组合；审核通过后才有编号 id */
export interface CommunityCombo {
  subId: string
  id?: number
  heroes: string[]
  source: string
  note?: string
  status: ReviewStatus
  reviewedBy?: string
  createdAt: string
  updatedAt: string
}

export type ComboInput = Pick<CommunityCombo, 'heroes' | 'source' | 'note'>

export interface AdminInfo {
  id: string
  name: string
  role: 'owner' | 'admin'
  createdBy?: string
  createdAt: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

// ---------- 本地保存的登录态与编辑口令 ----------

const SESSION_KEY = 's11.adminSession'
const MINE_KEY = 's11.mySubmissions'

function store(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export interface AdminSession {
  token: string
  admin: AdminInfo
}

const AUTH_EVENT = 's11-auth'

export const adminSession = {
  get(): AdminSession | null {
    try {
      return JSON.parse(store()?.getItem(SESSION_KEY) ?? 'null')
    } catch {
      return null
    }
  },
  set(s: AdminSession) {
    store()?.setItem(SESSION_KEY, JSON.stringify(s))
    dispatchEvent(new Event(AUTH_EVENT))
  },
  clear() {
    store()?.removeItem(SESSION_KEY)
    dispatchEvent(new Event(AUTH_EVENT))
  },
  /** 登录状态变化（含其他标签页）时回调，返回取消订阅函数 */
  subscribe(fn: () => void) {
    const onStorage = (e: StorageEvent) => e.key === SESSION_KEY && fn()
    addEventListener(AUTH_EVENT, fn)
    addEventListener('storage', onStorage)
    return () => {
      removeEventListener(AUTH_EVENT, fn)
      removeEventListener('storage', onStorage)
    }
  },
}

export type SubmissionKind = 'play' | 'combo'

export interface MySubmission {
  kind: SubmissionKind
  id: string
  key: string
}

export const mySubmissions = {
  list(): MySubmission[] {
    try {
      const list: MySubmission[] = JSON.parse(store()?.getItem(MINE_KEY) ?? '[]')
      return list.map((s) => ({ ...s, kind: s.kind ?? 'play' }))
    } catch {
      return []
    }
  },
  add(s: MySubmission) {
    store()?.setItem(MINE_KEY, JSON.stringify([s, ...this.list().filter((x) => x.id !== s.id)]))
  },
  remove(id: string) {
    store()?.setItem(MINE_KEY, JSON.stringify(this.list().filter((x) => x.id !== id)))
  },
  keyFor(id: string) {
    return this.list().find((x) => x.id === id)?.key
  },
}

// ---------- 请求 ----------

async function request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { ...extra }
  const session = adminSession.get()
  if (session) headers.Authorization = `Bearer ${session.token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, '连不上服务器')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && session) adminSession.clear()
    throw new ApiError(res.status, data.error ?? `请求失败（${res.status}）`, data)
  }
  return data as T
}

function editHeaders(id: string): Record<string, string> {
  const key = mySubmissions.keyFor(id)
  return key ? { 'X-Edit-Key': key } : {}
}

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/api/health'),
  community: () =>
    request<{
      plays: CommunityPlay[]
      combos: CommunityCombo[]
      docLayouts: Record<string, Layout & { updatedBy: string; updatedAt: string }>
      heroItems: Record<string, { items: string[]; updatedBy: string; updatedAt: string }>
    }>('GET', '/api/community'),
  setPlayLayout: (id: string, l: Layout) => request<CommunityPlay>('PUT', `/api/plays/${id}/layout`, l),
  setDocLayout: (row: number, l: Layout) => request<unknown>('PUT', `/api/doc-layouts/${row}`, l),
  setHeroItems: (hero: string, items: string[]) => request<unknown>('PUT', `/api/hero-items/${encodeURIComponent(hero)}`, { items }),

  messages: () => request<Message[]>('GET', '/api/messages'),
  postMessage: (m: { nick: string; content: string; website: string }) => request<Message>('POST', '/api/messages', m),
  updateMessage: (id: string, patch: { reply?: string; featured?: boolean }) =>
    request<Message>('PATCH', `/api/messages/${id}`, patch),
  deleteMessage: (id: string) => request<void>('DELETE', `/api/messages/${id}`),

  getPlay: (id: string) => request<CommunityPlay>('GET', `/api/plays/${id}`, undefined, editHeaders(id)),
  createPlay: (p: PlayInput) => request<{ play: CommunityPlay; editKey: string }>('POST', '/api/plays', p),
  updatePlay: (id: string, p: PlayInput) => request<CommunityPlay>('PUT', `/api/plays/${id}`, p, editHeaders(id)),
  deletePlay: (id: string) => request<void>('DELETE', `/api/plays/${id}`, undefined, editHeaders(id)),
  setPlayStatus: (id: string, status: ReviewStatus) => request<CommunityPlay>('POST', `/api/plays/${id}/status`, { status }),

  getCombo: (sid: string) => request<CommunityCombo>('GET', `/api/combos/${sid}`, undefined, editHeaders(sid)),
  createCombo: (c: ComboInput) => request<{ combo: CommunityCombo; editKey: string }>('POST', '/api/combos', c),
  updateCombo: (sid: string, c: ComboInput) => request<CommunityCombo>('PUT', `/api/combos/${sid}`, c, editHeaders(sid)),
  deleteCombo: (sid: string) => request<void>('DELETE', `/api/combos/${sid}`, undefined, editHeaders(sid)),
  setComboStatus: (sid: string, status: ReviewStatus) =>
    request<CommunityCombo>('POST', `/api/combos/${sid}/status`, { status }),

  login: (name: string, password: string) => request<AdminSession>('POST', '/api/admin/login', { name, password }),
  logout: () => request<void>('POST', '/api/admin/logout'),
  me: () => request<AdminInfo>('GET', '/api/admin/me'),
  changePassword: (old: string, next: string) => request<void>('POST', '/api/admin/password', { old, new: next }),
  review: () => request<{ plays: CommunityPlay[]; combos: CommunityCombo[] }>('GET', '/api/admin/review'),
  admins: () => request<AdminInfo[]>('GET', '/api/admin/admins'),
  createAdmin: (name: string, password: string) => request<AdminInfo>('POST', '/api/admin/admins', { name, password }),
  deleteAdmin: (id: string) => request<void>('DELETE', `/api/admin/admins/${id}`),
  resetAdminPassword: (id: string, password: string) =>
    request<void>('POST', `/api/admin/admins/${id}/password`, { password }),
}
