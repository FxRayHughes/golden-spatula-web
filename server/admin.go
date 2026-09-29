package main

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"
)

func bearer(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}

func (a *API) currentAdmin(r *http.Request) (Admin, bool) {
	return a.store.AdminBySession(bearer(r))
}

func (a *API) admin(h func(http.ResponseWriter, *http.Request, Admin)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := a.currentAdmin(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "请先以管理员身份登录"})
			return
		}
		h(w, r, me)
	}
}

func (a *API) owner(h func(http.ResponseWriter, *http.Request, Admin)) http.HandlerFunc {
	return a.admin(func(w http.ResponseWriter, r *http.Request, me Admin) {
		if me.Role != RoleOwner {
			forbidden(w, "只有站长可以管理管理员")
			return
		}
		h(w, r, me)
	})
}

func validPassword(pw string) error {
	if utf8.RuneCountInString(pw) < 10 {
		return bad("口令至少 10 位")
	}
	if len(pw) > 128 {
		return bad("口令太长")
	}
	return nil
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Password string }
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if !a.limit(w, r, a.loginLimit) {
		return
	}
	me, token, ok := a.store.Login(strings.TrimSpace(in.Name), in.Password)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "用户名或口令不正确"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "admin": me})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request, _ Admin) {
	if err := a.store.Logout(bearer(r)); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) me(w http.ResponseWriter, r *http.Request, me Admin) {
	writeJSON(w, http.StatusOK, me)
}

func (a *API) changePassword(w http.ResponseWriter, r *http.Request, me Admin) {
	var in struct{ Old, New string }
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if me.Role == RoleOwner {
		forbidden(w, "站长口令由环境变量 ADMIN_PASSWORD 管理，请修改后重启服务")
		return
	}
	if !a.store.CheckAdminPassword(me.ID, in.Old) {
		writeErr(w, bad("原口令不正确"))
		return
	}
	if err := validPassword(in.New); err != nil {
		writeErr(w, err)
		return
	}
	if err := a.store.SetAdminPassword(me.ID, in.New, bearer(r)); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// review 审核台：全部投稿（含待审核、已驳回）
func (a *API) review(w http.ResponseWriter, r *http.Request, _ Admin) {
	combos := a.store.Combos("")
	for i := range combos {
		combos[i] = publicCombo(combos[i])
	}
	writeJSON(w, http.StatusOK, map[string]any{"plays": publicPlays(a.store.Plays("")), "combos": combos})
}

func (a *API) listAdmins(w http.ResponseWriter, r *http.Request, _ Admin) {
	writeJSON(w, http.StatusOK, a.store.Admins())
}

func (a *API) createAdmin(w http.ResponseWriter, r *http.Request, me Admin) {
	var in struct{ Name, Password string }
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	name, err := cleanText(in.Name, "用户名", 20, true)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := validPassword(in.Password); err != nil {
		writeErr(w, err)
		return
	}
	ad, err := a.store.AddAdmin(name, in.Password, me.Name)
	if errors.Is(err, ErrConflict) {
		writeErr(w, conflict(nil, "用户名 %s 已存在", name))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ad)
}

func (a *API) deleteAdmin(w http.ResponseWriter, r *http.Request, _ Admin) {
	err := a.store.DeleteAdmin(r.PathValue("id"))
	if errors.Is(err, ErrConflict) {
		forbidden(w, "不能删除站长账号")
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) resetAdminPassword(w http.ResponseWriter, r *http.Request, _ Admin) {
	var in struct{ Password string }
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if err := validPassword(in.Password); err != nil {
		writeErr(w, err)
		return
	}
	for _, ad := range a.store.Admins() {
		if ad.ID == r.PathValue("id") && ad.Role == RoleOwner {
			forbidden(w, "站长口令由环境变量 ADMIN_PASSWORD 管理")
			return
		}
	}
	if err := a.store.SetAdminPassword(r.PathValue("id"), in.Password, ""); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
