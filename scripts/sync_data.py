#!/usr/bin/env python3
"""同步数据：腾讯文档《S11尊者玩法查询工具》+ 金铲铲官方资料库（画之灵 回归版）。

输出到 src/data/：heroes.json combos.json plays.json meta.json board.json items.json

腾讯文档读取方式：公开分享表格的 dop-api/opendoc 接口，返回 base64+zlib 压缩的 protobuf。
该表格 calcByFrontend=true，公式结果缓存在工作簿共享池里，本脚本直接读缓存值。
这是非公开的内部格式，文档结构或接口变化时需要调整。
"""
import ast
import base64
import json
from collections import Counter, defaultdict
import sys
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path

DOC_ID = "DYVRkeGF0QWNXa2xq"
DOC_URL = f"https://docs.qq.com/sheet/{DOC_ID}"
PLAY_TAB = "eebm8j"  # 玩法统计表
BOARD_TAB = "57bcdy"  # 留言板
JCC_VERSION = "11/18.11.1-S100030"  # 画之灵 回归版，见 jkzlk/js/config/versiondataconfig.js
JCC_BASE = f"https://game.gtimg.cn/images/lol/act/jkzlk/js/{JCC_VERSION}"
# 官方推荐阵容（金铲铲资料库「阵容推荐」），用于统计每个英雄的常用装备和站位
JCC_LINEUPS = "https://game.gtimg.cn/images/lol/act/jkzlkauto/json/lineupJson/m100030/11/11/lineup_detail_total.json"
ITEM_TYPES = ["成型装备", "转职纹章", "光明武器", "神器装备", "辅助装备", "特殊装备", "基础装备"]
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"
SERVER_DIR = ROOT / "server"

# 文档里的写法 → 金铲铲官方名
NAME_ALIAS = {"洛/霞": "霞与洛", "慧": "彗"}
IGNORED = {"清空"}  # 下拉框的占位选项
SUMMONS = {"提伯斯"}  # 召唤物，商店里买不到


def get(url, retries=3):
    headers = {"User-Agent": "Mozilla/5.0"}
    if "docs.qq.com" in url:
        headers["Referer"] = DOC_URL
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == retries - 1:
                raise


# ---------- protobuf（无 schema）----------

def _varint(b, i):
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, i


def fields(b):
    d, i = {}, 0
    while i < len(b):
        k, i = _varint(b, i)
        f, w = k >> 3, k & 7
        if w == 0:
            v, i = _varint(b, i)
        elif w == 1:
            v, i = b[i:i + 8], i + 8
        elif w == 5:
            v, i = b[i:i + 4], i + 4
        elif w == 2:
            n, i = _varint(b, i)
            v, i = b[i:i + n], i + n
        else:
            raise ValueError(f"wire type {w}")
        d.setdefault(f, []).append(v)
    return d


def _int(b):
    return fields(b).get(1, [0])[0] if b else 0


# ---------- 腾讯文档表格 ----------

def fetch_sheet_blob(tab):
    q = dict(id=DOC_ID, tab=tab, u="", noEscape=1, enableSmartsheetSplit=1, startrow=0, endrow=5000,
             needSheetState=1, sliceStates=1, block_start_row=0, block_end_row=5000, block_start_col=0,
             block_end_col=60, normal=1, outformat=1, wb=1, nowb=0)
    d = json.loads(get("https://docs.qq.com/dop-api/opendoc?" + urllib.parse.urlencode(q)))
    cv = d["clientVars"]
    wb = cv["collab_client_vars"]["initialAttributedText"]["text"][0]
    raw = b"".join(zlib.decompress(base64.b64decode(x["related_sheet"])) for x in wb["block_datas"])
    return raw, cv


def sheet_grid(raw, tab):
    """-> {(row, col): value}，值为 str / int / list（多选）"""
    top = fields(fields(raw)[1][0])
    body = None
    for sec in top[5]:
        s = fields(sec)
        if 19 not in s:
            continue
        c = fields(s[19][0])
        meta = fields(c[3][0]) if 3 in c else {}
        if meta.get(1, [b""])[0] == tab.encode() and 6 in c:
            body = c
    if body is None:
        raise RuntimeError(f"tab {tab} not found in response")
    P = fields(body[5][0])
    strs = [fields(e).get(1, [b""])[0].decode("utf-8", "replace") for e in P.get(1, [])]

    def value(vb):
        v = fields(vb)
        t = v.get(1, [0])[0]
        ref = _int(v[3][0]) if 3 in v else 0
        if t == 1:
            return strs[ref] if ref < len(strs) else None
        if t == 2:
            return ref
        return None

    results = [value(fields(e)[1][0]) if 1 in fields(e) else None for e in P.get(4, [])]
    g = {}
    for rawcell in body[6]:
        cc = fields(rawcell)
        if 3 not in cc:
            continue
        r, col = cc.get(1, [0])[0], cc.get(2, [0])[0]
        inner = fields(cc[3][0])
        t = inner.get(1, [None])[0]
        idx = _int(inner[2][0]) if 2 in inner else 0
        if t in (4, 6):
            g[(r, col)] = strs[idx]
        elif t == 2:
            g[(r, col)] = idx
        elif t == 5:
            g[(r, col)] = results[idx] if idx < len(results) else None
    return g


def split_heroes(s):
    if not isinstance(s, str):
        return []
    names = [NAME_ALIAS.get(x.strip(), x.strip()) for x in s.replace("，", ",").split(",")]
    return [x for x in names if x and x not in IGNORED]


def clean(s):
    return s.strip() if isinstance(s, str) and s.strip() else ""


# ---------- 金铲铲 ----------

def jcc(name):
    d = json.loads(get(f"{JCC_BASE}/{name}.js"))["data"]
    return list(d.values()) if isinstance(d, dict) else d


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    print("· 腾讯文档：玩法统计表")
    raw, cv = fetch_sheet_blob(PLAY_TAB)
    g = sheet_grid(raw, PLAY_TAB)
    cols = ["manual", "comboId", "comboHeroes", "source", "early", "earlyTips", "late", "lateTips", "link1", "link2"]
    combos, plays = {}, []
    for r in sorted({r for r, _ in g if r > 1}):
        row = {k: g.get((r, i)) for i, k in enumerate(cols)}
        if not any(clean(row[k]) for k in ("early", "late", "earlyTips", "lateTips")):
            continue
        cid = row["comboId"] if isinstance(row["comboId"], int) else None
        if cid and clean(row["comboHeroes"]):
            combos[cid] = split_heroes(row["comboHeroes"])
        plays.append({
            "row": r + 1,
            "comboId": cid,
            "source": clean(row["source"]),
            "early": split_heroes(row["early"]),
            "earlyTips": clean(row["earlyTips"]),
            "late": split_heroes(row["late"]),
            "lateTips": clean(row["lateTips"]),
            "links": [x for x in (clean(row["link1"]), clean(row["link2"])) if x],
        })

    print("· 腾讯文档：留言板")
    board_raw, _ = fetch_sheet_blob(BOARD_TAB)
    bg = sheet_grid(board_raw, BOARD_TAB)
    # 列：昵称 | 时间 | 精选 | 留言内容 | 细佬点评 | 化学必修（「时间」只拿得到数字池下标，不导出）
    board_names, board = [], []
    for r in sorted({r for r, _ in bg if r > 0}):
        n = clean(bg.get((r, 0)))
        if n and n != "昵称" and n not in board_names:
            board_names.append(n)
        content = clean(bg.get((r, 3)))
        if not content:
            continue
        replies = [{"by": by, "text": clean(bg.get((r, c)))}
                   for c, by in ((4, "NGA细佬"), (5, "化学必修2")) if clean(bg.get((r, c)))]
        board.append({"nick": n or "匿名", "content": content,
                      "featured": clean(bg.get((r, 2))) == "是", "replies": replies})

    print("· 金铲铲：chess / race / job")
    races = {x["id"]: x for x in jcc("race")}
    jobs = {x["id"]: x for x in jcc("job")}
    trait_by_id = {**races, **jobs}
    needed = {h for hs in combos.values() for h in hs} | {h for p in plays for h in p["early"] + p["late"]}
    heroes = {}
    for x in jcc("chess"):
        n = x["name"]
        if n in heroes or n in SUMMONS or x.get("showHeroTag") != "1" or not x["id"].startswith("1") or x["price"] == "0":
            continue
        tids = [t for t in f'{x["species"]}|{x["class"]}'.split("|") if t in trait_by_id]
        heroes[n] = {
            "id": x["id"],
            "name": n,
            "cost": int(x["price"]),
            "avatar": x["picture"],
            "traits": [trait_by_id[t]["name"] for t in tids],
            "exalted": False,
        }
        # 尊者不会抽中拥有 3 个及以上羁绊的弈子（原文档 60 个组合全部符合）
        heroes[n]["exaltable"] = len(heroes[n]["traits"]) < 3
    for hs in combos.values():
        for h in hs:
            if h in heroes:
                heroes[h]["exalted"] = True
    print("· 金铲铲：equip / 官方推荐阵容")
    equips = [e for e in jcc("equip") if e.get("type") in ITEM_TYPES]
    eq_by_id = {e["id"]: e for e in equips}
    out_items = [{
        "id": e["id"], "name": e["name"], "type": e["type"], "icon": e["picture"],
        "desc": clean(e.get("basicDesc")) + ("\n" + clean(e["desc"]) if clean(e.get("desc")) else ""),
        "recipe": [x for x in (e.get("synthesis1"), e.get("synthesis2")) if x and x != "0" and x in eq_by_id],
    } for e in sorted(equips, key=lambda e: (ITEM_TYPES.index(e["type"]), int(e.get("sort") or 0), e["id"]))]

    # 官方阵容里每个英雄携带的装备 → 按出现次数排序
    name_by_chess_id = {x["id"]: x["name"] for x in jcc("chess")}
    lineups = json.loads(get(JCC_LINEUPS))["lineup_list"]
    hero_items = defaultdict(Counter)
    for lu in lineups:
        d = lu["detail"] if isinstance(lu["detail"], dict) else json.loads(lu["detail"])
        locs = d["hero_location"] if isinstance(d["hero_location"], list) else ast.literal_eval(d["hero_location"])
        for h in locs:
            name = name_by_chess_id.get(h.get("hero_id"))
            if h.get("chess_type") != "hero" or name not in heroes:
                continue
            for i in filter(None, (h.get("equipment_id") or "").split(",")):
                if i in eq_by_id:
                    hero_items[name][i] += 1
    for n, h in heroes.items():
        h["items"] = [{"id": i, "count": c} for i, c in hero_items[n].most_common(6)]

    missing = sorted(needed - heroes.keys())
    traits = {t["name"]: t["picture"] for t in trait_by_id.values()}

    exalted = jobs.get("201", {})
    meta = {
        "syncedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "doc": {"title": cv.get("padTitle"), "url": DOC_URL,
                "lastModified": datetime.fromtimestamp(cv["lastModifyTime"] / 1000, timezone.utc).isoformat(timespec="seconds")},
        "jcc": {"version": JCC_VERSION, "base": JCC_BASE},
        "exalted": {"name": exalted.get("name"), "icon": exalted.get("picture"),
                    "desc": exalted.get("prefix"), "levels": exalted.get("desc2")},
        "traitIcons": traits,
        "unknownHeroes": missing,
        "boardNames": board_names,
        "itemSource": {"url": JCC_LINEUPS, "lineups": len(lineups),
                       "authors": [a for a, _ in Counter(lu["lineupauthor_data"]["name"] for lu in lineups).most_common()]},
    }

    out_heroes = sorted(heroes.values(), key=lambda h: (h["cost"], h["name"]))
    out_combos = [{"id": k, "heroes": v} for k, v in sorted(combos.items())]
    for name, data in [("heroes", out_heroes), ("combos", out_combos), ("plays", plays), ("meta", meta),
                       ("board", board), ("items", out_items)]:
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    # Go 后端用来校验投稿（go:embed 只能引用 server/ 目录内的文件）
    gamedata = {"heroes": [h["name"] for h in out_heroes], "exaltable": [h["name"] for h in out_heroes if h["exaltable"]],
                "combos": out_combos, "items": [e["id"] for e in out_items],
                "docRows": [p["row"] for p in plays]}
    (SERVER_DIR / "gamedata.json").write_text(json.dumps(gamedata, ensure_ascii=False), encoding="utf-8")

    print(f"✓ {len(out_combos)} 个组合，{len(plays)} 条玩法，{len(out_heroes)} 个英雄")
    if missing:
        print(f"! 金铲铲数据里找不到：{missing}", file=sys.stderr)


if __name__ == "__main__":
    main()
