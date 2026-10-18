// 宿舍规定（docs/07 §3）。
// 来源：清华大学学生社区管理服务中心《住宿注意事项》，页面日期 2026-03-18。以下为转述，不是原文。

export const RULES_SOURCE = Object.freeze({
  title: '清华大学学生社区管理服务中心《住宿注意事项》',
  date: '2026-03-18',
  url: 'https://www.tsinghua.edu.cn/xssqglfwzx/info/1043/1175.htm'
});

/**
 * kind：ban 禁用 / warn 警告 / hint 提示 / constraint 约束 / premise 产品前提
 * checkRules 只看 kind 为 ban 和 warn 的条目：先按 keywords 匹配 name/libId，再看 powerW。
 */
export const RULES = Object.freeze([
  { id: 'R-HEAT', clause: '第 12 条', kind: 'ban', label: '大功率发热电器',
    keywords: ['热得快', '电炉', '电热毯', '电热水器', '取暖器', '小太阳', '暖风机', '电暖器', 'e-blanket', 'heater'],
    text: '禁止使用热得快、电炉、电热毯、取暖器等发热电器', source: RULES_SOURCE.url },
  { id: 'R-COOK', clause: '第 12 条', kind: 'ban', label: '烹饪电器',
    keywords: ['电饭锅', '电饭煲', '电磁炉', '烤箱', '电热锅', '电煮锅', '电饼铛', '小火锅', 'rice-cooker'],
    text: '禁止使用电饭锅、电磁炉、电煮锅等烹饪电器', source: RULES_SOURCE.url },
  { id: 'R-POWER', clause: '第 12 条', kind: 'ban', label: '功率超标',
    maxPowerW: 1000,
    text: '禁止使用额定功率超过 1000W 的电器', source: RULES_SOURCE.url },
  { id: 'R-POWER-UNKNOWN', clause: '第 12 条', kind: 'warn', label: '功率未知',
    text: '需确认额定功率 ≤ 1000W', source: RULES_SOURCE.url },
  { id: 'R-CERT', clause: '第 12 条', kind: 'hint', label: '安全认证',
    text: '电器须有国家安全认证（3C），请在购买时确认', source: RULES_SOURCE.url },
  { id: 'R-EBIKE', clause: '第 13 条', kind: 'ban', label: '电动车电池',
    keywords: ['电动车电池', '电瓶'],
    text: '禁止把电动车电池、电瓶带进宿舍充电', source: RULES_SOURCE.url },
  { id: 'R-EXIT', clause: '第 12 条', kind: 'constraint', label: '疏散通道',
    zoneSlots: ['aisle', 'doorSwing', 'balconyWalk'],
    text: '不得堵塞疏散通道（过道、开门扇区、阳台通道保持空出）', source: RULES_SOURCE.url },
  { id: 'R-FIXED', clause: '第 17 条', kind: 'premise', label: '固定设施',
    text: '不得私自改变设施的位置和功能，因此固定家具不可移动', source: RULES_SOURCE.url }
]);
