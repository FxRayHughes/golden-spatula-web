package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// gamedata.json 由 scripts/sync_data.py 生成：英雄名单、可成为尊者的英雄、原文档的 60 个组合
//
//go:embed gamedata.json
var gamedataJSON []byte

type gamedata struct {
	Heroes    []string `json:"heroes"`
	Exaltable []string `json:"exaltable"`
	Combos    []struct {
		ID     int      `json:"id"`
		Heroes []string `json:"heroes"`
	} `json:"combos"`
	Items   []string `json:"items"`
	DocRows []int    `json:"docRows"`
}

type API struct {
	store       *Store
	trustProxy  bool
	heroes      map[string]bool
	exaltable   map[string]bool
	baseCombos  map[int]bool
	baseByKey   map[string]int
	items       map[string]bool
	docRows     map[int]bool
	msgLimit    *RateLimiter
	submitLimit *RateLimiter
	loginLimit  *RateLimiter
}

func NewAPI(store *Store, trustProxy bool) (*API, error) {
	var g gamedata
	if err := json.Unmarshal(gamedataJSON, &g); err != nil {
		return nil, fmt.Errorf("gamedata.json: %w", err)
	}
	set := func(names []string) map[string]bool {
		m := map[string]bool{}
		for _, n := range names {
			m[n] = true
		}
		return m
	}
	a := &API{
		store:       store,
		trustProxy:  trustProxy,
		heroes:      set(g.Heroes),
		exaltable:   set(g.Exaltable),
		baseCombos:  map[int]bool{},
		baseByKey:   map[string]int{},
		items:       set(g.Items),
		docRows:     map[int]bool{},
		msgLimit:    NewRateLimiter(10, time.Hour, 20*time.Second),
		submitLimit: NewRateLimiter(10, time.Hour, 10*time.Second),
		loginLimit:  NewRateLimiter(10, 10*time.Minute, 0),
	}
	for _, r := range g.DocRows {
		a.docRows[r] = true
	}
	for _, c := range g.Combos {
		a.baseCombos[c.ID] = true
		a.baseByKey[comboKey(c.Heroes)] = c.ID
	}
	return a, nil
}

func (a *API) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/community", a.community)

	mux.HandleFunc("GET /api/messages", a.listMessages)
	mux.HandleFunc("POST /api/messages", a.createMessage)
	mux.HandleFunc("PATCH /api/messages/{id}", a.admin(a.updateMessage))
	mux.HandleFunc("DELETE /api/messages/{id}", a.admin(a.deleteMessage))

	mux.HandleFunc("POST /api/plays", a.createPlay)
	mux.HandleFunc("GET /api/plays/{id}", a.getPlay)
	mux.HandleFunc("PUT /api/plays/{id}", a.updatePlay)
	mux.HandleFunc("DELETE /api/plays/{id}", a.deletePlay)
	mux.HandleFunc("POST /api/plays/{id}/status", a.admin(a.setPlayStatus))
	mux.HandleFunc("PUT /api/plays/{id}/layout", a.admin(a.setPlayLayout))
	mux.HandleFunc("PUT /api/doc-layouts/{row}", a.admin(a.setDocLayout))
	mux.HandleFunc("PUT /api/hero-items/{hero}", a.admin(a.setHeroItems))

	mux.HandleFunc("POST /api/combos", a.createCombo)
	mux.HandleFunc("GET /api/combos/{sid}", a.getCombo)
	mux.HandleFunc("PUT /api/combos/{sid}", a.updateCombo)
	mux.HandleFunc("DELETE /api/combos/{sid}", a.deleteCombo)
	mux.HandleFunc("POST /api/combos/{sid}/status", a.admin(a.setComboStatus))

	mux.HandleFunc("POST /api/admin/login", a.login)
	mux.HandleFunc("POST /api/admin/logout", a.admin(a.logout))
	mux.HandleFunc("GET /api/admin/me", a.admin(a.me))
	mux.HandleFunc("POST /api/admin/password", a.admin(a.changePassword))
	mux.HandleFunc("GET /api/admin/review", a.admin(a.review))
	mux.HandleFunc("GET /api/admin/admins", a.owner(a.listAdmins))
	mux.HandleFunc("POST /api/admin/admins", a.owner(a.createAdmin))
	mux.HandleFunc("DELETE /api/admin/admins/{id}", a.owner(a.deleteAdmin))
	mux.HandleFunc("POST /api/admin/admins/{id}/password", a.owner(a.resetAdminPassword))
}

// ---------- 通用 ----------

type apiError struct {
	status int
	msg    string
	extra  map[string]any
}

func (e apiError) Error() string { return e.msg }

func bad(format string, args ...any) error {
	return apiError{status: http.StatusBadRequest, msg: fmt.Sprintf(format, args...)}
}

func conflict(extra map[string]any, format string, args ...any) error {
	return apiError{status: http.StatusConflict, msg: fmt.Sprintf(format, args...), extra: extra}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	var ae apiError
	switch {
	case errors.As(err, &ae):
		body := map[string]any{"error": ae.msg}
		for k, v := range ae.extra {
			body[k] = v
		}
		writeJSON(w, ae.status, body)
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "不存在或已被删除"})
	default:
		log.Printf("internal error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "服务器错误"})
	}
}

func forbidden(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusForbidden, map[string]string{"error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return bad("请求格式不正确")
	}
	return nil
}

func (a *API) clientIP(r *http.Request) string {
	if a.trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
		if xr := r.Header.Get("X-Real-IP"); xr != "" {
			return xr
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// limit 对普通访客限流；管理员批量录入时不受限
func (a *API) limit(w http.ResponseWriter, r *http.Request, rl *RateLimiter) bool {
	if _, ok := a.currentAdmin(r); ok && rl != a.loginLimit {
		return true
	}
	ok, wait := rl.Allow(a.clientIP(r))
	if !ok {
		secs := int(math.Ceil(wait.Seconds()))
		w.Header().Set("Retry-After", fmt.Sprint(secs))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": fmt.Sprintf("操作太频繁，请 %d 秒后再试", secs)})
	}
	return ok
}

// cleanText 去掉首尾空白，按字符数（非字节）限制长度
func cleanText(s string, field string, max int, required bool) (string, error) {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if required && s == "" {
		return "", bad("%s不能为空", field)
	}
	if utf8.RuneCountInString(s) > max {
		return "", bad("%s最多 %d 个字", field, max)
	}
	return s, nil
}

// checkHeroes 去重并校验英雄名都在 allowed 里
func checkHeroes(list []string, field string, max int, allowed map[string]bool) ([]string, error) {
	if len(list) > max {
		return nil, bad("%s最多 %d 个英雄", field, max)
	}
	out := []string{}
	for _, h := range list {
		if !allowed[h] {
			return nil, bad("%s里有不符合要求的英雄：%s", field, h)
		}
		if !slices.Contains(out, h) {
			out = append(out, h)
		}
	}
	return out, nil
}

// ---------- 公开数据 ----------

func (a *API) community(w http.ResponseWriter, r *http.Request) {
	combos := a.store.Combos(StatusApproved)
	for i := range combos {
		combos[i] = publicCombo(combos[i])
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"plays":      publicPlays(a.store.Plays(StatusApproved)),
		"combos":     combos,
		"docLayouts": a.store.DocLayouts(),
		"heroItems":  a.store.HeroItems(),
	})
}

// ---------- 留言 ----------

type messageIn struct {
	Nick    string `json:"nick"`
	Content string `json:"content"`
	Website string `json:"website"` // 蜜罐字段，正常用户看不到，填了就是机器人
}

func (a *API) listMessages(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.store.Messages())
}

func (a *API) createMessage(w http.ResponseWriter, r *http.Request) {
	var in messageIn
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.Website != "" {
		writeJSON(w, http.StatusCreated, Message{ID: newID(), Nick: in.Nick, Content: in.Content, CreatedAt: time.Now()})
		return
	}
	nick, err := cleanText(in.Nick, "昵称", 20, false)
	if err != nil {
		writeErr(w, err)
		return
	}
	if nick == "" {
		nick = "匿名"
	}
	content, err := cleanText(in.Content, "留言内容", 500, true)
	if err != nil {
		writeErr(w, err)
		return
	}
	if !a.limit(w, r, a.msgLimit) {
		return
	}
	m, err := a.store.AddMessage(nick, content)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (a *API) updateMessage(w http.ResponseWriter, r *http.Request, me Admin) {
	var in struct {
		Reply    *string `json:"reply"`
		Featured *bool   `json:"featured"`
	}
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.Reply != nil {
		s, err := cleanText(*in.Reply, "回复", 500, false)
		if err != nil {
			writeErr(w, err)
			return
		}
		in.Reply = &s
	}
	m, err := a.store.UpdateMessage(r.PathValue("id"), in.Reply, in.Featured, me.Name)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (a *API) deleteMessage(w http.ResponseWriter, r *http.Request, _ Admin) {
	if err := a.store.DeleteMessage(r.PathValue("id")); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- 玩法投稿 ----------

func publicPlay(p Play) Play {
	p.EditKeyHash = ""
	return p
}

func publicPlays(ps []Play) []Play {
	for i := range ps {
		ps[i] = publicPlay(ps[i])
	}
	return ps
}

func (a *API) validatePlay(in Play) (Play, error) {
	var err error
	if in.Source, err = cleanText(in.Source, "思路来源（作者）", 20, true); err != nil {
		return in, err
	}
	if in.EarlyTips, err = cleanText(in.EarlyTips, "过渡要点", 1000, false); err != nil {
		return in, err
	}
	if in.LateTips, err = cleanText(in.LateTips, "大成要点", 1000, false); err != nil {
		return in, err
	}
	if in.Early, err = checkHeroes(in.Early, "过渡阵容", 10, a.heroes); err != nil {
		return in, err
	}
	if in.Late, err = checkHeroes(in.Late, "大成阵容", 12, a.heroes); err != nil {
		return in, err
	}
	if len(in.Early) == 0 && len(in.Late) == 0 {
		return in, bad("过渡阵容和大成阵容至少填一个")
	}
	switch {
	case in.ComboID > 0 && len(in.NewCombo) > 0:
		return in, bad("请只选择已有组合或登记新组合其中一种")
	case in.ComboID > 0:
		if !a.baseCombos[in.ComboID] && !a.store.ApprovedComboExists(in.ComboID) {
			return in, bad("组合 #%d 不存在或还没通过审核", in.ComboID)
		}
	case len(in.NewCombo) > 0:
		if in.NewCombo, err = a.validateComboHeroes(in.NewCombo); err != nil {
			return in, err
		}
		if id, ok := a.baseByKey[comboKey(in.NewCombo)]; ok {
			in.ComboID, in.NewCombo = id, nil
		}
	default:
		return in, bad("请选择这套玩法对应的尊者组合")
	}
	links := []string{}
	for _, l := range in.Links {
		l, err := cleanText(l, "链接", 300, false)
		if err != nil {
			return in, err
		}
		if l == "" {
			continue
		}
		if u, e := url.Parse(l); e == nil && u.Scheme != "" && u.Scheme != "http" && u.Scheme != "https" {
			return in, bad("链接只支持 http / https")
		}
		links = append(links, l)
	}
	if len(links) > 3 {
		return in, bad("最多 3 个链接")
	}
	in.Links = links
	if in.Layout, err = a.validateLayout(in.Layout, append(append([]string{}, in.Early...), in.Late...)); err != nil {
		return in, err
	}
	return in, nil
}

// editor 判断请求者能否修改这条投稿：返回管理员名（管理员）或空串（持有编辑口令的投稿人）
func (a *API) editor(r *http.Request, keyHash string) (by string, ok bool) {
	if me, ok := a.currentAdmin(r); ok {
		return me.Name, true
	}
	return "", keyMatches(r.Header.Get("X-Edit-Key"), keyHash)
}

func (a *API) createPlay(w http.ResponseWriter, r *http.Request) {
	var in Play
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	in, err := a.validatePlay(in)
	if err != nil {
		writeErr(w, err)
		return
	}
	if !a.limit(w, r, a.submitLimit) {
		return
	}
	p, key, err := a.store.AddPlay(in)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"play": publicPlay(p), "editKey": key})
}

func (a *API) getPlay(w http.ResponseWriter, r *http.Request) {
	p, err := a.store.GetPlay(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, ok := a.editor(r, p.EditKeyHash); !ok && p.Status != StatusApproved {
		writeErr(w, ErrNotFound)
		return
	}
	writeJSON(w, http.StatusOK, publicPlay(p))
}

func (a *API) updatePlay(w http.ResponseWriter, r *http.Request) {
	cur, err := a.store.GetPlay(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	by, ok := a.editor(r, cur.EditKeyHash)
	if !ok {
		forbidden(w, "没有编辑这条投稿的权限")
		return
	}
	var in Play
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in, err = a.validatePlay(in); err != nil {
		writeErr(w, err)
		return
	}
	p, err := a.store.UpdatePlay(cur.ID, in, by)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, publicPlay(p))
}

func (a *API) deletePlay(w http.ResponseWriter, r *http.Request) {
	cur, err := a.store.GetPlay(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, ok := a.editor(r, cur.EditKeyHash); !ok {
		forbidden(w, "没有删除这条投稿的权限")
		return
	}
	if err := a.store.DeletePlay(cur.ID); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func readStatus(w http.ResponseWriter, r *http.Request) (string, error) {
	var in struct {
		Status string `json:"status"`
	}
	if err := readJSON(w, r, &in); err != nil {
		return "", err
	}
	if !slices.Contains([]string{StatusPending, StatusApproved, StatusRejected}, in.Status) {
		return "", bad("未知状态：%s", in.Status)
	}
	return in.Status, nil
}

func (a *API) setPlayStatus(w http.ResponseWriter, r *http.Request, me Admin) {
	status, err := readStatus(w, r)
	if err != nil {
		writeErr(w, err)
		return
	}
	p, err := a.store.SetPlayStatus(r.PathValue("id"), status, me.Name)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, publicPlay(p))
}
