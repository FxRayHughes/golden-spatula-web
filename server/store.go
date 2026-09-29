package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

// 社区组合编号从这里开始，和原文档的 1~60 号区分开
const firstCommunityComboID = 1001

const (
	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusRejected = "rejected"

	RoleOwner = "owner" // 站长：由环境变量创建，可管理其他管理员
	RoleAdmin = "admin"

	sessionTTL = 7 * 24 * time.Hour
)

// 口令哈希迭代次数；测试里调低
var pbkdf2Iterations = 600_000

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Message struct {
	ID        string    `json:"id"`
	Nick      string    `json:"nick"`
	Content   string    `json:"content"`
	Reply     string    `json:"reply,omitempty"`
	ReplyBy   string    `json:"replyBy,omitempty"`
	Featured  bool      `json:"featured"`
	CreatedAt time.Time `json:"createdAt"`
}

type Play struct {
	ID        string   `json:"id"`
	ComboID   int      `json:"comboId,omitempty"`
	NewCombo  []string `json:"newCombo,omitempty"` // 投稿人登记的新组合，审核通过后转成 ComboID
	Source    string   `json:"source"`
	Early     []string `json:"early"`
	EarlyTips string   `json:"earlyTips"`
	Late      []string `json:"late"`
	LateTips  string   `json:"lateTips"`
	Links     []string `json:"links"`
	Layout
	Status      string    `json:"status"`
	ReviewedBy  string    `json:"reviewedBy,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	EditKeyHash string    `json:"editKeyHash,omitempty"`
}

// Layout 大成阵容的站位与装备：Positions 英雄 → "行,列"（4 行 × 7 列，1 行为前排），Items 英雄 → 装备 id（最多 3 件）
type Layout struct {
	Items     map[string][]string `json:"items,omitempty"`
	Positions map[string]string   `json:"positions,omitempty"`
}

// DocLayout 原文档玩法（按行号）的站位与装备，由管理员补充
type DocLayout struct {
	Layout
	UpdatedBy string    `json:"updatedBy"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// HeroItems 管理员维护的英雄推荐装备，覆盖官方阵容统计
type HeroItems struct {
	Items     []string  `json:"items"`
	UpdatedBy string    `json:"updatedBy"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Combo 社区登记的尊者组合。审核通过后才分配编号 ID 并参与查询。
type Combo struct {
	SubID       string    `json:"subId"`
	ID          int       `json:"id,omitempty"`
	Heroes      []string  `json:"heroes"`
	Source      string    `json:"source"`
	Note        string    `json:"note,omitempty"`
	Status      string    `json:"status"`
	ReviewedBy  string    `json:"reviewedBy,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	EditKeyHash string    `json:"editKeyHash,omitempty"`
}

type Admin struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Salt      string    `json:"salt,omitempty"`
	Hash      string    `json:"hash,omitempty"`
	CreatedBy string    `json:"createdBy,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type session struct {
	TokenHash string    `json:"tokenHash"`
	AdminID   string    `json:"adminId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type snapshot struct {
	Messages    []*Message            `json:"messages"`
	Plays       []*Play               `json:"plays"`
	Combos      []*Combo              `json:"combos"`
	NextComboID int                   `json:"nextComboId"`
	Admins      []*Admin              `json:"admins"`
	Sessions    []*session            `json:"sessions"`
	DocLayouts  map[int]*DocLayout    `json:"docLayouts,omitempty"`
	HeroItems   map[string]*HeroItems `json:"heroItems,omitempty"`
}

// Store 把全部数据放在内存里，每次修改后原子写回 DATA_DIR/store.json。
// 数据量是几百条的量级，单实例部署足够。
type Store struct {
	mu   sync.RWMutex
	path string
	data snapshot
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "store.json"), data: snapshot{NextComboID: firstCommunityComboID}}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, s.saveLocked()
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.data); err != nil {
		return nil, err
	}
	if s.data.NextComboID < firstCommunityComboID {
		s.data.NextComboID = firstCommunityComboID
	}
	// 旧版本的社区组合没有审核状态，都是随玩法审核通过的
	for _, c := range s.data.Combos {
		if c.SubID == "" {
			c.SubID = newID()
		}
		if c.Status == "" {
			c.Status = StatusApproved
		}
	}
	return s, nil
}

func (s *Store) saveLocked() error {
	b, err := json.MarshalIndent(s.data, "", " ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func newKey() (key, hash string) {
	b := make([]byte, 18)
	rand.Read(b)
	key = hex.EncodeToString(b)
	return key, hashKey(key)
}

func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

func keyMatches(key, hash string) bool {
	return key != "" && hash != "" && subtle.ConstantTimeCompare([]byte(hashKey(key)), []byte(hash)) == 1
}

func comboKey(heroes []string) string {
	h := slices.Clone(heroes)
	sort.Strings(h)
	return strings.Join(h, ",")
}

// ---------- 管理员 ----------

func hashPassword(pw, salt string) string {
	k, _ := pbkdf2.Key(sha256.New, pw, []byte(salt), pbkdf2Iterations, 32)
	return hex.EncodeToString(k)
}

func (a *Admin) setPassword(pw string) {
	a.Salt = newID() + newID()
	a.Hash = hashPassword(pw, a.Salt)
}

func (a *Admin) checkPassword(pw string) bool {
	return subtle.ConstantTimeCompare([]byte(hashPassword(pw, a.Salt)), []byte(a.Hash)) == 1
}

// EnsureOwner 用环境变量里的账号口令创建（或同步）站长账号，忘记口令时改环境变量重启即可
func (s *Store) EnsureOwner(name, pw string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.data.Admins {
		if a.Name == name {
			a.Role = RoleOwner
			if a.checkPassword(pw) {
				return nil
			}
			a.setPassword(pw)
			s.dropSessionsLocked(a.ID)
			return s.saveLocked()
		}
	}
	a := &Admin{ID: newID(), Name: name, Role: RoleOwner, CreatedBy: "环境变量", CreatedAt: time.Now().UTC()}
	a.setPassword(pw)
	s.data.Admins = append(s.data.Admins, a)
	return s.saveLocked()
}

func publicAdmin(a Admin) Admin {
	a.Salt, a.Hash = "", ""
	return a
}

func (s *Store) Admins() []Admin {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Admin{}
	for _, a := range s.data.Admins {
		out = append(out, publicAdmin(*a))
	}
	return out
}

func (s *Store) AddAdmin(name, pw, createdBy string) (Admin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if slices.ContainsFunc(s.data.Admins, func(a *Admin) bool { return a.Name == name }) {
		return Admin{}, ErrConflict
	}
	a := &Admin{ID: newID(), Name: name, Role: RoleAdmin, CreatedBy: createdBy, CreatedAt: time.Now().UTC()}
	a.setPassword(pw)
	s.data.Admins = append(s.data.Admins, a)
	return publicAdmin(*a), s.saveLocked()
}

func (s *Store) DeleteAdmin(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.data.Admins, func(a *Admin) bool { return a.ID == id })
	if i < 0 {
		return ErrNotFound
	}
	if s.data.Admins[i].Role == RoleOwner {
		return ErrConflict
	}
	s.data.Admins = slices.Delete(s.data.Admins, i, i+1)
	s.dropSessionsLocked(id)
	return s.saveLocked()
}

// SetAdminPassword 修改口令并让该账号的其他登录全部失效（keepToken 为当前会话，可保留）
func (s *Store) SetAdminPassword(id, pw, keepToken string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.data.Admins {
		if a.ID == id {
			a.setPassword(pw)
			keep := hashKey(keepToken)
			s.data.Sessions = slices.DeleteFunc(s.data.Sessions, func(x *session) bool {
				return x.AdminID == id && x.TokenHash != keep
			})
			return s.saveLocked()
		}
	}
	return ErrNotFound
}

func (s *Store) CheckAdminPassword(id, pw string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.data.Admins {
		if a.ID == id {
			return a.checkPassword(pw)
		}
	}
	return false
}

// Login 校验账号口令，成功时返回新会话令牌
func (s *Store) Login(name, pw string) (Admin, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.data.Admins {
		if a.Name == name {
			if !a.checkPassword(pw) {
				break
			}
			tok, hash := newKey()
			now := time.Now()
			s.data.Sessions = slices.DeleteFunc(s.data.Sessions, func(x *session) bool { return now.After(x.ExpiresAt) })
			s.data.Sessions = append(s.data.Sessions, &session{TokenHash: hash, AdminID: a.ID, ExpiresAt: now.Add(sessionTTL)})
			if err := s.saveLocked(); err != nil {
				return Admin{}, "", false
			}
			return publicAdmin(*a), tok, true
		}
	}
	// 用户名不存在时也算一次哈希，避免通过响应时间探测账号
	hashPassword(pw, "timing")
	return Admin{}, "", false
}

func (s *Store) AdminBySession(token string) (Admin, bool) {
	if token == "" {
		return Admin{}, false
	}
	h := hashKey(token)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, x := range s.data.Sessions {
		if x.TokenHash == h && time.Now().Before(x.ExpiresAt) {
			for _, a := range s.data.Admins {
				if a.ID == x.AdminID {
					return publicAdmin(*a), true
				}
			}
		}
	}
	return Admin{}, false
}

func (s *Store) Logout(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := hashKey(token)
	s.data.Sessions = slices.DeleteFunc(s.data.Sessions, func(x *session) bool { return x.TokenHash == h })
	return s.saveLocked()
}

func (s *Store) dropSessionsLocked(adminID string) {
	s.data.Sessions = slices.DeleteFunc(s.data.Sessions, func(x *session) bool { return x.AdminID == adminID })
}

// ---------- 留言 ----------

func (s *Store) Messages() []Message {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Message, 0, len(s.data.Messages))
	for i := len(s.data.Messages) - 1; i >= 0; i-- {
		out = append(out, *s.data.Messages[i])
	}
	return out
}

func (s *Store) AddMessage(nick, content string) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := &Message{ID: newID(), Nick: nick, Content: content, CreatedAt: time.Now().UTC()}
	s.data.Messages = append(s.data.Messages, m)
	return *m, s.saveLocked()
}

func (s *Store) UpdateMessage(id string, reply *string, featured *bool, by string) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.data.Messages {
		if m.ID == id {
			if reply != nil {
				m.Reply, m.ReplyBy = *reply, by
				if *reply == "" {
					m.ReplyBy = ""
				}
			}
			if featured != nil {
				m.Featured = *featured
			}
			return *m, s.saveLocked()
		}
	}
	return Message{}, ErrNotFound
}

func (s *Store) DeleteMessage(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.data.Messages, func(m *Message) bool { return m.ID == id })
	if i < 0 {
		return ErrNotFound
	}
	s.data.Messages = slices.Delete(s.data.Messages, i, i+1)
	return s.saveLocked()
}

// ---------- 组合 ----------

// Combos 返回副本；status 为空表示全部
func (s *Store) Combos(status string) []Combo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Combo{}
	for _, c := range s.data.Combos {
		if status == "" || c.Status == status {
			out = append(out, *c)
		}
	}
	return out
}

func (s *Store) findCombo(subID string) *Combo {
	for _, c := range s.data.Combos {
		if c.SubID == subID {
			return c
		}
	}
	return nil
}

func (s *Store) GetCombo(subID string) (Combo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if c := s.findCombo(subID); c != nil {
		return *c, nil
	}
	return Combo{}, ErrNotFound
}

// ApprovedComboExists 判断一个社区组合编号是否可以被玩法引用
func (s *Store) ApprovedComboExists(id int) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.ContainsFunc(s.data.Combos, func(c *Combo) bool { return c.ID == id && c.Status == StatusApproved })
}

// FindSameCombo 查找英雄集合相同、且未被驳回的社区组合（exceptSub 为正在编辑的那条）
func (s *Store) FindSameCombo(heroes []string, exceptSub string) (Combo, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k := comboKey(heroes)
	for _, c := range s.data.Combos {
		if c.SubID != exceptSub && c.Status != StatusRejected && comboKey(c.Heroes) == k {
			return *c, true
		}
	}
	return Combo{}, false
}

func (s *Store) AddCombo(in Combo) (Combo, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key, hash := newKey()
	now := time.Now().UTC()
	c := &Combo{SubID: newID(), Heroes: in.Heroes, Source: in.Source, Note: in.Note, Status: StatusPending,
		CreatedAt: now, UpdatedAt: now, EditKeyHash: hash}
	s.data.Combos = append(s.data.Combos, c)
	return *c, key, s.saveLocked()
}

func (s *Store) UpdateCombo(subID string, in Combo, byAdmin bool) (Combo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.findCombo(subID)
	if c == nil {
		return Combo{}, ErrNotFound
	}
	if !byAdmin && c.Status == StatusApproved {
		return Combo{}, ErrConflict
	}
	c.Heroes, c.Source, c.Note, c.UpdatedAt = in.Heroes, in.Source, in.Note, time.Now().UTC()
	if !byAdmin {
		c.Status = StatusPending
	}
	return *c, s.saveLocked()
}

func (s *Store) SetComboStatus(subID, status, by string) (Combo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.findCombo(subID)
	if c == nil {
		return Combo{}, ErrNotFound
	}
	if status != StatusApproved && c.ID != 0 && s.comboInUseLocked(c.ID) {
		return Combo{}, ErrConflict
	}
	c.Status, c.ReviewedBy, c.UpdatedAt = status, by, time.Now().UTC()
	if status == StatusApproved && c.ID == 0 {
		c.ID = s.data.NextComboID
		s.data.NextComboID++
	}
	return *c, s.saveLocked()
}

func (s *Store) comboInUseLocked(id int) bool {
	return slices.ContainsFunc(s.data.Plays, func(p *Play) bool { return p.ComboID == id })
}

func (s *Store) DeleteCombo(subID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.data.Combos, func(c *Combo) bool { return c.SubID == subID })
	if i < 0 {
		return ErrNotFound
	}
	if c := s.data.Combos[i]; c.ID != 0 && s.comboInUseLocked(c.ID) {
		return ErrConflict
	}
	s.data.Combos = slices.Delete(s.data.Combos, i, i+1)
	return s.saveLocked()
}

// approvedComboForLocked 找到或新建一个已通过的社区组合（随玩法一起登记的新组合）
func (s *Store) approvedComboForLocked(heroes []string, source, by string) int {
	k := comboKey(heroes)
	for _, c := range s.data.Combos {
		if comboKey(c.Heroes) == k && c.Status != StatusRejected {
			if c.ID == 0 {
				c.ID = s.data.NextComboID
				s.data.NextComboID++
			}
			c.Status, c.ReviewedBy = StatusApproved, by
			return c.ID
		}
	}
	now := time.Now().UTC()
	c := &Combo{SubID: newID(), ID: s.data.NextComboID, Heroes: slices.Clone(heroes), Source: source,
		Note: "随玩法投稿登记", Status: StatusApproved, ReviewedBy: by, CreatedAt: now, UpdatedAt: now}
	s.data.NextComboID++
	s.data.Combos = append(s.data.Combos, c)
	return c.ID
}

// ---------- 玩法 ----------

func (s *Store) Plays(status string) []Play {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Play{}
	for _, p := range s.data.Plays {
		if status == "" || p.Status == status {
			out = append(out, *p)
		}
	}
	return out
}

func (s *Store) GetPlay(id string) (Play, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if p := s.findPlay(id); p != nil {
		return *p, nil
	}
	return Play{}, ErrNotFound
}

func (s *Store) findPlay(id string) *Play {
	for _, p := range s.data.Plays {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (s *Store) AddPlay(in Play) (Play, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key, hash := newKey()
	now := time.Now().UTC()
	in.ID, in.Status, in.CreatedAt, in.UpdatedAt, in.EditKeyHash = newID(), StatusPending, now, now, hash
	in.ReviewedBy = ""
	p := in
	s.data.Plays = append(s.data.Plays, &p)
	return p, key, s.saveLocked()
}

// UpdatePlay 覆盖可编辑字段。投稿人自己改过的内容要重新审核，管理员修改保持原状态。
func (s *Store) UpdatePlay(id string, in Play, by string) (Play, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.findPlay(id)
	if p == nil {
		return Play{}, ErrNotFound
	}
	p.ComboID, p.NewCombo = in.ComboID, in.NewCombo
	p.Source, p.Early, p.EarlyTips, p.Late, p.LateTips, p.Links = in.Source, in.Early, in.EarlyTips, in.Late, in.LateTips, in.Links
	p.Layout = in.Layout
	p.UpdatedAt = time.Now().UTC()
	if by != "" {
		if p.Status == StatusApproved && len(p.NewCombo) > 0 {
			p.ComboID, p.NewCombo = s.approvedComboForLocked(p.NewCombo, p.Source, by), nil
		}
	} else {
		p.Status, p.ReviewedBy = StatusPending, ""
	}
	return *p, s.saveLocked()
}

func (s *Store) SetPlayStatus(id, status, by string) (Play, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.findPlay(id)
	if p == nil {
		return Play{}, ErrNotFound
	}
	p.Status, p.ReviewedBy = status, by
	if status == StatusApproved && len(p.NewCombo) > 0 {
		p.ComboID, p.NewCombo = s.approvedComboForLocked(p.NewCombo, p.Source, by), nil
	}
	p.UpdatedAt = time.Now().UTC()
	return *p, s.saveLocked()
}

func (s *Store) DeletePlay(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := slices.IndexFunc(s.data.Plays, func(p *Play) bool { return p.ID == id })
	if i < 0 {
		return ErrNotFound
	}
	s.data.Plays = slices.Delete(s.data.Plays, i, i+1)
	return s.saveLocked()
}

// ---------- 站位 / 装备 ----------

// SetPlayLayout 管理员只改站位和装备，不影响审核状态
func (s *Store) SetPlayLayout(id string, l Layout) (Play, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.findPlay(id)
	if p == nil {
		return Play{}, ErrNotFound
	}
	p.Layout, p.UpdatedAt = l, time.Now().UTC()
	return *p, s.saveLocked()
}

func (s *Store) DocLayouts() map[int]DocLayout {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[int]DocLayout{}
	for k, v := range s.data.DocLayouts {
		out[k] = *v
	}
	return out
}

// SetDocLayout 空布局等于删除覆盖
func (s *Store) SetDocLayout(row int, l Layout, by string) (DocLayout, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.DocLayouts == nil {
		s.data.DocLayouts = map[int]*DocLayout{}
	}
	d := &DocLayout{Layout: l, UpdatedBy: by, UpdatedAt: time.Now().UTC()}
	if len(l.Items) == 0 && len(l.Positions) == 0 {
		delete(s.data.DocLayouts, row)
	} else {
		s.data.DocLayouts[row] = d
	}
	return *d, s.saveLocked()
}

func (s *Store) HeroItems() map[string]HeroItems {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]HeroItems{}
	for k, v := range s.data.HeroItems {
		out[k] = *v
	}
	return out
}

// SetHeroItems 空列表等于恢复官方统计
func (s *Store) SetHeroItems(hero string, items []string, by string) (HeroItems, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.HeroItems == nil {
		s.data.HeroItems = map[string]*HeroItems{}
	}
	h := &HeroItems{Items: items, UpdatedBy: by, UpdatedAt: time.Now().UTC()}
	if len(items) == 0 {
		delete(s.data.HeroItems, hero)
	} else {
		s.data.HeroItems[hero] = h
	}
	return *h, s.saveLocked()
}
