// 署名信息全部摘自原腾讯文档《S11尊者玩法查询工具》：
// 工具页说明区、辅助-频道列表（经工具页缓存）、各作者分表、留言板。
// 玩法来源统计与留言板昵称由 scripts/sync_data.py 同步，见 data/plays.json、data/meta.json。

export interface Person {
  name: string
  note?: string
  links?: { label: string; url?: string }[]
}

export const techCredits: Person[] = [
  { name: '化学必修2', note: '收集尊者组合信息，提供表格技术支持' },
  {
    name: 'NGA细佬',
    note: '提供表格技术支持',
    links: [{ label: 'NGA', url: 'https://bbs.nga.cn/thread.php?authorid=64296928' }],
  },
]

export const mainAuthors: Person[] = [
  {
    name: '手刃猫咪',
    note: 'B站、微信',
    links: [{ label: 'B站', url: 'https://space.bilibili.com/262943792' }],
  },
  {
    name: '冰摇桃桃绿',
    note: 'B站',
    links: [{ label: 'B站', url: 'https://space.bilibili.com/10737753' }],
  },
  {
    name: '小鱼一图流',
    note: '抖音、微信、B站',
    links: [{ label: 'B站、微信公众号、抖音同名搜索' }],
  },
]

// 原文档中有独立「玩法统计表-xxx」分表的作者（按文档中 tab 名）
export const authorSheets = ['海燕纳丶', '曲静同学', '小鱼', '手刃猫咪', '冰摇桃桃绿']

// 「辅助-频道列表」中登记的来源
export const channelList = [
  '海燕呐丶',
  '曲静同学',
  '冰摇桃桃绿',
  '小鱼一图流',
  '手刃猫咪',
  'Mugetsu梦月',
  '山海神谕',
  '五杀是用来抢的诺克萨斯',
  '阿米',
  '7kismet',
  '匿名',
  '只能靠脸吃饭',
  'Wozzk',
  'NGA细佬',
]

export const docRefs = [
  { label: '尊者列表（原文档引用，现已失效）', url: 'https://tactics.tools/zh/info/set-11/tables/exalted' },
]
