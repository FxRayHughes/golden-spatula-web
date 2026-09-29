package main

import (
	"errors"
	"fmt"
	"net/http"
)

func publicCombo(c Combo) Combo {
	c.EditKeyHash = ""
	return c
}

func comboLabel(id int) string {
	if id >= firstCommunityComboID {
		return fmt.Sprintf("新%d", id-firstCommunityComboID+1)
	}
	return fmt.Sprint(id)
}

// validateComboHeroes：3~6 个可成为尊者的英雄（拥有 3 个及以上羁绊的弈子不会成为尊者）
func (a *API) validateComboHeroes(heroes []string) ([]string, error) {
	h, err := checkHeroes(heroes, "尊者组合", 6, a.exaltable)
	if err != nil {
		return nil, err
	}
	if len(h) < 3 {
		return nil, bad("尊者组合至少要选 3 个棋子")
	}
	return h, nil
}

// duplicateOf 检查组合是否已被收录（原文档或社区登记，驳回的不算）
func (a *API) duplicateOf(heroes []string, exceptSub string) error {
	if id, ok := a.baseByKey[comboKey(heroes)]; ok {
		return conflict(map[string]any{"comboId": id}, "这就是原文档收录的 #%d 号组合", id)
	}
	if c, ok := a.store.FindSameCombo(heroes, exceptSub); ok {
		if c.Status == StatusApproved {
			return conflict(map[string]any{"comboId": c.ID}, "这个组合已经收录为 #%s 号", comboLabel(c.ID))
		}
		return conflict(nil, "这个组合已经有人登记过，正在等待审核")
	}
	return nil
}

func (a *API) validateCombo(in Combo, exceptSub string) (Combo, error) {
	var err error
	if in.Heroes, err = a.validateComboHeroes(in.Heroes); err != nil {
		return in, err
	}
	if in.Source, err = cleanText(in.Source, "登记人", 20, true); err != nil {
		return in, err
	}
	if in.Note, err = cleanText(in.Note, "备注", 300, false); err != nil {
		return in, err
	}
	return in, a.duplicateOf(in.Heroes, exceptSub)
}

func (a *API) createCombo(w http.ResponseWriter, r *http.Request) {
	var in Combo
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	in, err := a.validateCombo(in, "")
	if err != nil {
		writeErr(w, err)
		return
	}
	if !a.limit(w, r, a.submitLimit) {
		return
	}
	c, key, err := a.store.AddCombo(in)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"combo": publicCombo(c), "editKey": key})
}

func (a *API) getCombo(w http.ResponseWriter, r *http.Request) {
	c, err := a.store.GetCombo(r.PathValue("sid"))
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, ok := a.editor(r, c.EditKeyHash); !ok && c.Status != StatusApproved {
		writeErr(w, ErrNotFound)
		return
	}
	writeJSON(w, http.StatusOK, publicCombo(c))
}

func (a *API) updateCombo(w http.ResponseWriter, r *http.Request) {
	cur, err := a.store.GetCombo(r.PathValue("sid"))
	if err != nil {
		writeErr(w, err)
		return
	}
	by, ok := a.editor(r, cur.EditKeyHash)
	if !ok {
		forbidden(w, "没有编辑这条登记的权限")
		return
	}
	var in Combo
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in, err = a.validateCombo(in, cur.SubID); err != nil {
		writeErr(w, err)
		return
	}
	c, err := a.store.UpdateCombo(cur.SubID, in, by != "")
	if errors.Is(err, ErrConflict) {
		writeErr(w, conflict(nil, "组合已通过审核，不能再修改；如有错误请在留言板反馈"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, publicCombo(c))
}

func (a *API) deleteCombo(w http.ResponseWriter, r *http.Request) {
	cur, err := a.store.GetCombo(r.PathValue("sid"))
	if err != nil {
		writeErr(w, err)
		return
	}
	by, ok := a.editor(r, cur.EditKeyHash)
	if !ok || (by == "" && cur.Status == StatusApproved) {
		forbidden(w, "没有删除这条登记的权限")
		return
	}
	err = a.store.DeleteCombo(cur.SubID)
	if errors.Is(err, ErrConflict) {
		writeErr(w, conflict(nil, "还有玩法引用这个组合，请先处理这些玩法"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) setComboStatus(w http.ResponseWriter, r *http.Request, me Admin) {
	status, err := readStatus(w, r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if status == StatusApproved {
		cur, err := a.store.GetCombo(r.PathValue("sid"))
		if err != nil {
			writeErr(w, err)
			return
		}
		if err := a.duplicateOf(cur.Heroes, cur.SubID); err != nil {
			writeErr(w, err)
			return
		}
	}
	c, err := a.store.SetComboStatus(r.PathValue("sid"), status, me.Name)
	if errors.Is(err, ErrConflict) {
		writeErr(w, conflict(nil, "还有已发布的玩法引用这个组合，不能下架"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, publicCombo(c))
}
