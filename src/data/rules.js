// 宿舍规定（docs/07 §3）。
// 来源：清华大学学生社区管理服务中心《住宿注意事项》，页面日期 2026-03-18。以下为转述，不是原文。

export const RULES_SOURCE = Object.freeze({
  title: '清华大学学生社区管理服务中心《住宿注意事项》',
  date: '2026-03-18',
  url: 'https://www.tsinghua.edu.cn/xssqglfwzx/info/1043/1175.htm'
});

/**
 * kind：ban 禁用 / warn 警告 / hint 提示 / constraint 约束 / premise 产品前提
 * checkRules 先按 keywords 匹配 name/libId、检查 powerW，再接纳 Item.safety 的额外风险。
 */
export const RULES = Object.freeze([
  // 火种工具按产品安全预检保守拦截；不声称校规逐项列出了所有别名。
  { id: 'R-FIRE', clause: '通用宿舍安全预检', kind: 'ban', label: '火种与明火器具',
    keywords: ['打火机', '点火石', '打火石', '打火棒', '生火棒', '镁棒', '镁条', '镁块', '火柴', '蜡烛', '火蚊香', '艾灸', '酒精炉', '煤油炉', '喷火枪', '喷灯', 'lighter', 'firestarter', 'firesteel', 'ferrocerium'],
    text: '具有点火、产生火花或使用明火的用途，暂不提供宿舍收纳方案；请勿在宿舍使用，携带要求向宿管核实', source: RULES_SOURCE.url },
  { id: 'R-FUEL', clause: '第 12 条', kind: 'ban', label: '易燃液体与燃气',
    keywords: ['汽油', '柴油', '煤油', '燃油', '酒精', '乙醇', '甲醇', '乙醚', '丙酮', '白电油', '香蕉水', '松节油', '油漆稀释剂', '燃气罐', '煤气罐', '液化气罐', '丁烷气罐', '丁烷罐', '卡式气罐', '卡式炉气罐', '丙烷气罐', '打火机充气罐', 'gasoline', 'kerosene', 'butane', 'propane'],
    text: '公寓内不得储藏或使用易燃、易爆危险品；成分、包装或用途不明时先交由宿管核实', source: RULES_SOURCE.url },
  { id: 'R-EXPLOSIVE', clause: '第 12 条', kind: 'ban', label: '爆炸与烟火物品',
    keywords: ['烟花', '爆竹', '鞭炮', '炸药', '火药', '雷管', '引爆器', 'fireworks', 'firecracker', 'explosive'],
    text: '公寓内不得储藏或使用易爆物质及烟花爆竹', source: RULES_SOURCE.url },
  { id: 'R-HAZMAT', clause: '第 12 条', kind: 'ban', label: '毒害、腐蚀与放射性物品',
    keywords: ['强酸', '强碱', '浓硫酸', '浓盐酸', '浓硝酸', '氢氧化钠', '氢氧化钾', '氰化物', '氯气', '毒害品', '剧毒物', '有毒化学品', '腐蚀性试剂', '放射源', '放射性物质'],
    text: '公寓内不得储藏或使用毒害性、放射性、腐蚀性物质等危险品', source: RULES_SOURCE.url },
  { id: 'R-WEAPON', clause: '通用宿舍安全预检', kind: 'ban', label: '武器与管制物品',
    keywords: ['管制刀具', '弹药', '子弹', '枪支', '电击枪'],
    text: '武器、弹药及明确管制物品不进入宿舍收纳规划，请联系宿管核实处置',
    source: 'https://peace.tsinghua.edu.cn/info/1004/1709.htm' },
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
