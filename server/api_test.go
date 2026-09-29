package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const ownerPassword = "owner-password-123"

type client struct {
	t     *testing.T
	srv   *httptest.Server
	store *Store
}

func newClient(t *testing.T) *client {
	pbkdf2Iterations = 1000
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.EnsureOwner("站长", ownerPassword); err != nil {
		t.Fatal(err)
	}
	api, err := NewAPI(store, false)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	api.Routes(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &client{t, srv, store}
}

func (c *client) do(method, path string, body any, headers map[string]string, out any) int {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, c.srv.URL+path, &buf)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

// login 返回可直接当请求头用的 Authorization
func (c *client) login(name, pw string) map[string]string {
	c.t.Helper()
	var out struct{ Token string }
	if code := c.do("POST", "/api/admin/login", map[string]string{"name": name, "password": pw}, nil, &out); code != 200 {
		c.t.Fatalf("login %s: %d", name, code)
	}
	return map[string]string{"Authorization": "Bearer " + out.Token}
}

func key(k string) map[string]string { return map[string]string{"X-Edit-Key": k} }

func TestAdmins(t *testing.T) {
	c := newClient(t)
	if code := c.do("POST", "/api/admin/login", map[string]string{"name": "站长", "password": "wrong-password"}, nil, nil); code != 401 {
		t.Errorf("wrong password: %d", code)
	}
	owner := c.login("站长", ownerPassword)

	var me Admin
	c.do("GET", "/api/admin/me", nil, owner, &me)
	if me.Role != RoleOwner || me.Hash != "" {
		t.Fatalf("me: %+v", me)
	}

	var bob Admin
	if code := c.do("POST", "/api/admin/admins", map[string]string{"name": "小鱼", "password": "bob-password-1"}, owner, &bob); code != 201 {
		t.Fatalf("create admin: %d", code)
	}
	if code := c.do("POST", "/api/admin/admins", map[string]string{"name": "小鱼", "password": "bob-password-2"}, owner, nil); code != 409 {
		t.Errorf("duplicate admin: %d", code)
	}
	bobH := c.login("小鱼", "bob-password-1")

	// 普通管理员能审核，但不能管理管理员
	if code := c.do("GET", "/api/admin/review", nil, bobH, nil); code != 200 {
		t.Errorf("admin review: %d", code)
	}
	if code := c.do("GET", "/api/admin/admins", nil, bobH, nil); code != 403 {
		t.Errorf("admin list admins: %d", code)
	}
	var owners []Admin
	c.do("GET", "/api/admin/admins", nil, owner, &owners)
	if len(owners) != 2 {
		t.Fatalf("admins: %d", len(owners))
	}
	if code := c.do("DELETE", "/api/admin/admins/"+owners[0].ID, nil, owner, nil); code != 403 {
		t.Errorf("delete owner: %d", code)
	}

	// 修改口令后旧登录仍有效（当前会话保留），新口令可登录
	if code := c.do("POST", "/api/admin/password", map[string]string{"old": "bob-password-1", "new": "bob-password-9"}, bobH, nil); code != 204 {
		t.Errorf("change password: %d", code)
	}
	c.login("小鱼", "bob-password-9")

	// 删除后会话立即失效
	c.do("DELETE", "/api/admin/admins/"+bob.ID, nil, owner, nil)
	if code := c.do("GET", "/api/admin/me", nil, bobH, nil); code != 401 {
		t.Errorf("deleted admin session: %d", code)
	}
	if code := c.do("POST", "/api/admin/logout", nil, owner, nil); code != 204 {
		t.Errorf("logout: %d", code)
	}
	if code := c.do("GET", "/api/admin/me", nil, owner, nil); code != 401 {
		t.Errorf("after logout: %d", code)
	}
}

func TestMessages(t *testing.T) {
	c := newClient(t)
	admin := c.login("站长", ownerPassword)
	var m Message
	if code := c.do("POST", "/api/messages", map[string]string{"nick": " 小明 ", "content": "好用！"}, nil, &m); code != 201 {
		t.Fatalf("create: %d", code)
	}
	if m.Nick != "小明" {
		t.Errorf("nick not trimmed: %q", m.Nick)
	}
	if code := c.do("POST", "/api/messages", map[string]string{"content": "再来一条"}, nil, nil); code != 429 {
		t.Errorf("rate limit: %d", code)
	}
	if code := c.do("PATCH", "/api/messages/"+m.ID, map[string]any{"reply": "谢谢"}, nil, nil); code != 401 {
		t.Errorf("reply without login: %d", code)
	}
	var upd Message
	c.do("PATCH", "/api/messages/"+m.ID, map[string]any{"reply": "谢谢", "featured": true}, admin, &upd)
	if upd.Reply != "谢谢" || upd.ReplyBy != "站长" || !upd.Featured {
		t.Errorf("admin update: %+v", upd)
	}
	if code := c.do("DELETE", "/api/messages/"+m.ID, nil, admin, nil); code != 204 {
		t.Errorf("delete: %d", code)
	}
}

func TestComboSubmission(t *testing.T) {
	c := newClient(t)
	admin := c.login("站长", ownerPassword)
	heroes := []string{"阿狸", "凯特琳", "盖伦", "亚索", "慎"}

	cases := map[string]map[string]any{
		"原文档已有": {"heroes": []string{"阿狸", "凯特琳", "德莱厄斯", "可酷伯", "墨菲特", "盖伦"}, "source": "a"},
		"太少":    {"heroes": []string{"阿狸", "凯特琳"}, "source": "a"},
		"三羁绊英雄": {"heroes": []string{"阿狸", "凯特琳", "克格莫"}, "source": "a"},
		"无登记人":  {"heroes": heroes},
	}
	for name, body := range cases {
		code := c.do("POST", "/api/combos", body, admin, nil)
		if want := map[bool]int{true: 409, false: 400}[name == "原文档已有"]; code != want {
			t.Errorf("%s: want %d, got %d", name, want, code)
		}
	}

	var created struct {
		Combo   Combo
		EditKey string
	}
	if code := c.do("POST", "/api/combos", map[string]any{"heroes": heroes, "source": "玩家A", "note": "9/29 实战"}, nil, &created); code != 201 {
		t.Fatalf("create: %d", code)
	}
	sid := created.Combo.SubID
	if created.Combo.ID != 0 || created.Combo.Status != StatusPending {
		t.Fatalf("pending combo should have no id: %+v", created.Combo)
	}
	// 同一组合换个顺序再登记 → 冲突
	if code := c.do("POST", "/api/combos", map[string]any{"heroes": []string{"慎", "亚索", "盖伦", "凯特琳", "阿狸"}, "source": "b"}, admin, nil); code != 409 {
		t.Errorf("duplicate pending: %d", code)
	}
	// 未审核的组合不能被玩法引用，也不公开
	var community struct{ Combos []Combo }
	c.do("GET", "/api/community", nil, nil, &community)
	if len(community.Combos) != 0 {
		t.Error("pending combo must not be public")
	}
	// 投稿人可修改待审核的登记
	var upd Combo
	c.do("PUT", "/api/combos/"+sid, map[string]any{"heroes": heroes, "source": "玩家A", "note": "补充截图"}, key(created.EditKey), &upd)
	if upd.Note != "补充截图" {
		t.Errorf("author update: %+v", upd)
	}

	var ok Combo
	c.do("POST", "/api/combos/"+sid+"/status", map[string]string{"status": "approved"}, admin, &ok)
	if ok.ID != firstCommunityComboID || ok.ReviewedBy != "站长" {
		t.Fatalf("approved: %+v", ok)
	}
	c.do("GET", "/api/community", nil, nil, &community)
	if len(community.Combos) != 1 || community.Combos[0].EditKeyHash != "" {
		t.Fatalf("community combos: %+v", community.Combos)
	}
	// 通过后投稿人不能再改
	if code := c.do("PUT", "/api/combos/"+sid, map[string]any{"heroes": heroes, "source": "x"}, key(created.EditKey), nil); code != 409 {
		t.Errorf("author edit after approval: %d", code)
	}
	// 玩法可以引用；被引用后不能删除组合
	if code := c.do("POST", "/api/plays", map[string]any{"comboId": ok.ID, "source": "b", "late": []string{"慎"}}, admin, nil); code != 201 {
		t.Errorf("play on community combo: %d", code)
	}
	if code := c.do("DELETE", "/api/combos/"+sid, nil, admin, nil); code != 409 {
		t.Errorf("delete used combo: %d", code)
	}
}

func TestPlayLifecycle(t *testing.T) {
	c := newClient(t)
	admin := c.login("站长", ownerPassword)
	in := map[string]any{"comboId": 39, "source": "测试作者", "early": []string{"阿狸", "凯特琳"}, "links": []string{"https://example.com"}}
	var created struct {
		Play    Play
		EditKey string
	}
	if code := c.do("POST", "/api/plays", in, nil, &created); code != 201 {
		t.Fatalf("create: %d", code)
	}
	id := created.Play.ID
	if code := c.do("GET", "/api/plays/"+id, nil, nil, nil); code != 404 {
		t.Errorf("anonymous get pending: %d", code)
	}
	var p Play
	c.do("POST", "/api/plays/"+id+"/status", map[string]string{"status": "approved"}, admin, &p)
	if p.ReviewedBy != "站长" {
		t.Errorf("reviewedBy: %q", p.ReviewedBy)
	}
	in["lateTips"] = "补充要点"
	if code := c.do("PUT", "/api/plays/"+id, in, key("wrong"), nil); code != 403 {
		t.Errorf("wrong key: %d", code)
	}
	var upd Play
	c.do("PUT", "/api/plays/"+id, in, key(created.EditKey), &upd)
	if upd.Status != StatusPending || upd.ReviewedBy != "" {
		t.Errorf("author edit should need re-review: %+v", upd)
	}
	if code := c.do("DELETE", "/api/plays/"+id, nil, key(created.EditKey), nil); code != 204 {
		t.Errorf("author delete: %d", code)
	}
}

func TestPlayWithNewCombo(t *testing.T) {
	c := newClient(t)
	admin := c.login("站长", ownerPassword)
	combo := []string{"阿狸", "凯特琳", "盖伦", "亚索", "慎"}
	var ids []string
	for range 2 {
		var created struct{ Play Play }
		c.do("POST", "/api/plays", map[string]any{"newCombo": combo, "source": "a", "early": []string{"阿狸"}}, admin, &created)
		ids = append(ids, created.Play.ID)
	}
	var p1, p2 Play
	c.do("POST", "/api/plays/"+ids[0]+"/status", map[string]string{"status": "approved"}, admin, &p1)
	c.do("POST", "/api/plays/"+ids[1]+"/status", map[string]string{"status": "approved"}, admin, &p2)
	if p1.ComboID != firstCommunityComboID || p2.ComboID != p1.ComboID || len(p1.NewCombo) != 0 {
		t.Errorf("same new combo should share id: %d %d", p1.ComboID, p2.ComboID)
	}
	// 随玩法登记的新组合如果其实是原文档组合，直接归到原编号
	var created struct{ Play Play }
	c.do("POST", "/api/plays", map[string]any{"newCombo": []string{"盖伦", "墨菲特", "德莱厄斯", "阿狸", "凯特琳", "可酷伯"}, "source": "a", "early": []string{"阿狸"}}, admin, &created)
	if created.Play.ComboID != 39 {
		t.Errorf("base combo not recognized: %+v", created.Play)
	}
}

func TestPlayValidation(t *testing.T) {
	c := newClient(t)
	cases := map[string]map[string]any{
		"无组合":    {"source": "a", "early": []string{"阿狸"}},
		"组合不存在":  {"comboId": 999, "source": "a", "early": []string{"阿狸"}},
		"未审核组合":  {"comboId": firstCommunityComboID, "source": "a", "early": []string{"阿狸"}},
		"未知英雄":   {"comboId": 1, "source": "a", "early": []string{"不存在"}},
		"无阵容":    {"comboId": 1, "source": "a"},
		"无作者":    {"comboId": 1, "early": []string{"阿狸"}},
		"新组合非尊者": {"newCombo": []string{"阿狸", "凯特琳", "克格莫"}, "source": "a", "early": []string{"阿狸"}},
		"危险链接":   {"comboId": 1, "source": "a", "early": []string{"阿狸"}, "links": []string{"javascript:alert(1)"}},
	}
	for name, body := range cases {
		if code := c.do("POST", "/api/plays", body, nil, nil); code != 400 {
			t.Errorf("%s: want 400, got %d", name, code)
		}
	}
}

func TestLayouts(t *testing.T) {
	c := newClient(t)
	admin := c.login("站长", ownerPassword)
	// 投稿时带站位与装备
	good := map[string]any{"comboId": 39, "source": "a", "late": []string{"阿狸", "盖伦"},
		"positions": map[string]string{"阿狸": "4,3", "盖伦": "1,4"}, "items": map[string][]string{"阿狸": {"2003", "2003"}}}
	var created struct{ Play Play }
	if code := c.do("POST", "/api/plays", good, admin, &created); code != 201 {
		t.Fatalf("create with layout: %d", code)
	}
	if created.Play.Positions["阿狸"] != "4,3" || len(created.Play.Items["阿狸"]) != 2 {
		t.Errorf("layout not saved: %+v", created.Play.Layout)
	}
	bads := map[string]map[string]any{
		"不在阵容": {"positions": map[string]string{"慎": "1,1"}},
		"越界":   {"positions": map[string]string{"阿狸": "5,1"}},
		"同一格":  {"positions": map[string]string{"阿狸": "1,1", "盖伦": "1,1"}},
		"装备太多": {"items": map[string][]string{"阿狸": {"2003", "2003", "2003", "2003"}}},
		"未知装备": {"items": map[string][]string{"阿狸": {"999999"}}},
	}
	for name, body := range bads {
		if code := c.do("PUT", "/api/plays/"+created.Play.ID+"/layout", body, admin, nil); code != 400 {
			t.Errorf("%s: want 400, got %d", name, code)
		}
	}
	// 管理员改站位不影响审核状态
	var p Play
	c.do("PUT", "/api/plays/"+created.Play.ID+"/layout", map[string]any{"positions": map[string]string{"阿狸": "3,3"}}, admin, &p)
	if p.Positions["阿狸"] != "3,3" || p.Status != StatusPending || len(p.Items) != 0 {
		t.Errorf("admin layout: %+v", p)
	}
	if code := c.do("PUT", "/api/plays/"+created.Play.ID+"/layout", map[string]any{}, nil, nil); code != 401 {
		t.Errorf("anon layout: %d", code)
	}

	// 原文档玩法补充站位
	if code := c.do("PUT", "/api/doc-layouts/99999", map[string]any{}, admin, nil); code != 404 {
		t.Errorf("unknown doc row: %d", code)
	}
	var d DocLayout
	c.do("PUT", "/api/doc-layouts/203", map[string]any{"positions": map[string]string{"加里奥": "1,4"}}, admin, &d)
	if d.UpdatedBy != "站长" {
		t.Errorf("doc layout: %+v", d)
	}
	// 英雄推荐装备
	if code := c.do("PUT", "/api/hero-items/艾希", map[string]any{"items": []string{"2003", "21110"}}, admin, nil); code != 200 {
		t.Errorf("hero items: %d", code)
	}
	var comm struct {
		DocLayouts map[string]DocLayout
		HeroItems  map[string]HeroItems
	}
	c.do("GET", "/api/community", nil, nil, &comm)
	if comm.DocLayouts["203"].Positions["加里奥"] != "1,4" || len(comm.HeroItems["艾希"].Items) != 2 {
		t.Errorf("community: %+v", comm)
	}
	c.do("PUT", "/api/hero-items/艾希", map[string]any{"items": []string{}}, admin, nil)
	var comm2 struct{ HeroItems map[string]HeroItems }
	c.do("GET", "/api/community", nil, nil, &comm2)
	if _, ok := comm2.HeroItems["艾希"]; ok {
		t.Error("empty list should reset to official")
	}
}
