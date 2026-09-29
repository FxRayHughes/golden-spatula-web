package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

const (
	boardRows       = 4
	boardCols       = 7
	maxItemsPerHero = 3
	maxHeroItems    = 6
)

// validateLayout 校验站位与装备；lineup 非空时英雄必须在阵容里
func (a *API) validateLayout(l Layout, lineup []string) (Layout, error) {
	inLineup := map[string]bool{}
	for _, h := range lineup {
		inLineup[h] = true
	}
	checkHero := func(h, field string) error {
		if !a.heroes[h] {
			return bad("%s里有未知英雄：%s", field, h)
		}
		if lineup != nil && !inLineup[h] {
			return bad("%s里的「%s」不在阵容中", field, h)
		}
		return nil
	}
	out := Layout{}
	used := map[string]string{}
	for h, pos := range l.Positions {
		if err := checkHero(h, "站位"); err != nil {
			return out, err
		}
		r, c, ok := parsePos(pos)
		if !ok {
			return out, bad("「%s」的站位格式不正确：%s", h, pos)
		}
		pos = fmt.Sprintf("%d,%d", r, c)
		if other, dup := used[pos]; dup {
			return out, bad("「%s」和「%s」站在同一格", h, other)
		}
		used[pos] = h
		if out.Positions == nil {
			out.Positions = map[string]string{}
		}
		out.Positions[h] = pos
	}
	for h, items := range l.Items {
		if err := checkHero(h, "装备"); err != nil {
			return out, err
		}
		list, err := a.checkItems(items, "「"+h+"」的装备", maxItemsPerHero)
		if err != nil {
			return out, err
		}
		if len(list) > 0 {
			if out.Items == nil {
				out.Items = map[string][]string{}
			}
			out.Items[h] = list
		}
	}
	return out, nil
}

func parsePos(s string) (r, c int, ok bool) {
	parts := strings.Split(s, ",")
	if len(parts) != 2 {
		return 0, 0, false
	}
	r, e1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	c, e2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	return r, c, e1 == nil && e2 == nil && r >= 1 && r <= boardRows && c >= 1 && c <= boardCols
}

// checkItems 装备 id 有效、数量不超过 max（同一件装备可以重复）
func (a *API) checkItems(items []string, field string, max int) ([]string, error) {
	if len(items) > max {
		return nil, bad("%s最多 %d 件", field, max)
	}
	for _, id := range items {
		if !a.items[id] {
			return nil, bad("%s里有未知装备：%s", field, id)
		}
	}
	return append([]string{}, items...), nil
}

// PUT /api/plays/{id}/layout  管理员直接改社区玩法的站位与装备
func (a *API) setPlayLayout(w http.ResponseWriter, r *http.Request, _ Admin) {
	cur, err := a.store.GetPlay(r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	var in Layout
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	l, err := a.validateLayout(in, append(append([]string{}, cur.Early...), cur.Late...))
	if err != nil {
		writeErr(w, err)
		return
	}
	p, err := a.store.SetPlayLayout(cur.ID, l)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, publicPlay(p))
}

// PUT /api/doc-layouts/{row}  管理员为原文档玩法补充站位与装备
func (a *API) setDocLayout(w http.ResponseWriter, r *http.Request, me Admin) {
	row, err := strconv.Atoi(r.PathValue("row"))
	if err != nil || !a.docRows[row] {
		writeErr(w, ErrNotFound)
		return
	}
	var in Layout
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	l, err := a.validateLayout(in, nil)
	if err != nil {
		writeErr(w, err)
		return
	}
	d, err := a.store.SetDocLayout(row, l, me.Name)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// PUT /api/hero-items/{hero}  管理员维护英雄推荐装备；空列表恢复官方统计
func (a *API) setHeroItems(w http.ResponseWriter, r *http.Request, me Admin) {
	hero := r.PathValue("hero")
	if !a.heroes[hero] {
		writeErr(w, bad("未知英雄：%s", hero))
		return
	}
	var in struct{ Items []string }
	if err := readJSON(w, r, &in); err != nil {
		writeErr(w, err)
		return
	}
	items, err := a.checkItems(in.Items, "推荐装备", maxHeroItems)
	if err != nil {
		writeErr(w, err)
		return
	}
	h, err := a.store.SetHeroItems(hero, items, me.Name)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, h)
}
