# 问题清单（只能在末尾追加）

格式：`- [ ] [时间] [归属车道 A/B/C/D] 现象；复现步骤；发现者`
修好后由归属车道把 `[ ]` 改成 `[x]`。

---

- [x] [15:31] [归属车道 C] EP01 离线降级时，警报流直接显示 DISABLED 等技术诊断码；复现：未配置 AI 时进入入住→载入新生示例，警报流出现 DISABLED。请 source=rules 时只展示「AI 离线，已使用本地解析」，完整诊断留独立开发页；发现者 D。
- [ ] [15:31] [归属车道 A] 当前集成版本没有 src/scene/index.js，完整页面中央一直显示「3D 模块加载中 / STANDBY」；复现：首页→入住规划→选择未知收纳箱→腾桌执行，文字结果可用但宿舍线框、物品落位、容差幽灵盒和力场动画均无法验收。待 A 推送后复测；发现者 D。
- [x] [15:31] [归属车道 C] EP02 尚未执行指令就把当前同步率更新为完成后的 100%，右栏未标明预判；复现：载入乱桌→展开力场（6 冲突、7 步），此时仍是原 placements，但 syncPatch 使用 placementsAfter，执行后同步率不再上升。建议保留当前同步率、另显预判，完成执行后再更新；发现者 D。

- [15:34] [D 复验 → C] 上述「离线警报显示 DISABLED」已由 C4 修复：在关闭 AI 代理的生产预览页用指定文本实测 source=rules、8 件，观众警报仅显示中文，控制台无报错。保留原记录供 C 勾选；发现者 D。
- [15:34] [D 集成走查进度] 已完成真实 AI 与规则双路径 8 件验收；EP01 示例五类判定及收纳箱容差、EP02 6 冲突/7 步/0.26㎡与专注计时、EP03 10→12 月及复用切换、EP04 四个快照回放均已实测。任务卡 D4 完整演示项暂未勾选：A 场景入口仍缺席，需其推送后复验 3D 落位、容差幽灵盒、红绿力场及物品动画；发现者 D。
- [x] [15:35] [归属车道 B] 乱桌加载后锁定 A.desk，再调用 planFocusField：返回 conflicts/steps/unresolved 均空，但 computeSync(...focusBox).parts.focus 为0；锁定应禁止移动同时保留冲突/未解决提示。C 已在面板阻止对锁定桌面生成指令，并用真实 focus 分数保护净空状态；发现者 C
- [x] [15:37] [归属车道 B] planMoveIn 对已有锁区快递盒（disposable）即使传 opts.existing 仍先判丢弃并删除 placement；普通锁区物品可通过 existing 保持。请让固定 existing 的位置优先于丢弃建议，或在 verdict 中保留位置并只提示建议。C 不修改引擎；发现者 C

- [ ] [16:25] [归属车道 C] 首页三审 SVG 触发浏览器控制台错误 `Error: <svg> attribute height: Expected length, "auto".`；复现：当前主分支运行 dev，打开首页即出现，EP01/EP02 更新三审时重复。来源为 `src/ui/widgets/tribunal.js:40` 的 `height="auto"`（由 monitor.js 插入）。请去掉非法 SVG 高度属性或改成合法长度，响应式高度由 CSS 负责；发现者 D。
- [16:27] [D 集成复验] 主分支 32e4be9：npm test 138/138、npm run build 通过；源码及 dist 密钥模式扫描无匹配，只有 .env.example 被跟踪，.env.local 已忽略。浏览器复验新生示例在 AI 超时后自动规则回退到 34 件（22 能放下 / 9 换位置 / 2 尺寸待定 / 0 放不下 / 1 禁止），观众警报只有中文；收纳箱容差可展开。EP02 展开时当前同步率保留 75%，另显预计 100%，7 步包含一次级联。待机演示已走到 EP04，Escape 退出恢复到原 EP02 的物品、同步率和 5/7 进度，且未写入本地档案。D4 完整演示项继续保留未完成：A 的场景入口仍缺席，另待 C 修复上述 SVG 控制台错误；发现者 D。
- [ ] [16:27] [归属车道 C / 美术] 1280×720、100% 缩放时，右栏三审下方「心 / 时」节点被固定底栏裁切，无法完整同屏展示；复现：EP02 载入乱桌 → 展开并执行 7 步 → 将视口设为 1280×720。与 CHANGES.md 16:11 的待处理要求一致，建议在该尺寸验收时连同同步率区域压缩；发现者 D。
- [16:27] [D 集成复验补充] 退出待机后继续执行剩余指令可到 7/7，同步率实测更新为 100%，物品数从 30 变为 29（快递盒已丢弃）；发现者 D。
- [16:29] [D → C 复验更新] 推送时已同步 C 的 336a8f6 与演示测试 a06d7f7。1280×720 下 EP00 与 EP02 展开力场后，三审节点已完整可见（EP02 三审底部约 y=497，底栏从 y=644 开始），上述裁切项已由新样式解决，请 C 勾选；SVG `height="auto"` 控制台错误仍可复现。当前项目显式运行 `node --test src/ai/*.test.js tests/*.test.js` 为 147 项、144 pass、0 fail、3 todo（零食箱、两摞书、成长快照残留快递盒），build 成功。npm test 也退出 0，但本机新增未跟踪的 dormArrange-test/ 副本会被递归发现并重复计数；D 未修改该目录。

- [ ] [16:29] [归属车道 C] 【高】场景任一 set* 方法抛错会让整页失效：sceneBinder 的 update 和 store.set 的广播都没有 try/catch，异常一路冒到 main()，render() 在 bindScene 之后才订阅，于是面板永不渲染；运行中抛错则 store.set 中断，后续订阅者（面板、监视器）收不到更新，EP01「开始规划」会误报"规划暂未完成"；复现：用一个 setItemStates 抛错的 scene 对象调用 bindScene(store, scene)（Node 中已复现：初始调用即抛出，后续订阅者未收到 itemStates）；建议：sceneBinder 每个 scene 调用包 try/catch（失败时降级到 blueprint 并 alert 一次），store.set 对每个 listener 单独 try/catch + console.error；A 车道推送 scene 后这是首要风险；发现者 Claude-test
- [ ] [16:29] [归属车道 C] 【高】按演示脚本顺序走到 EP03 时没有冬装可出箱：EP02「载入乱桌示例」把 items 换成 30 件乱桌物品（季节物品只有小风扇），EP03 的「载入示例」在 items 非空时直接 return 且无提示；复现：EP01 规划 → EP02 载入乱桌 → EP03 拖到 10→12 月，diffMonths 为 0 步、compare on/off 相同（planner 实测 0 步、maxFill 0.559/0.559）；建议：EP03 示例按钮在 items 不含季节物品时也允许载入（先确认替换），或进入 EP03 时若无季节物品自动提示"载入换季示例"；发现者 Claude-test
- [x] [16:29] [归属车道 B] 【高】parseItemsText 把"零"当中文数字转成 0：「零食箱」解析为名称"食箱"、无 libId、按 storage 默认 44×32×26，「零食」同理；观众互动最常说的就是零食；复现：parseItemsText('零食箱') → name '食箱'、libId undefined（tests/demo-flow.test.js 有 todo 用例）；建议：normalize 的中文数字正则不单独匹配"零"，只在与其他数字相邻时转换（如"一百零五"），或先做物品库别名匹配再转数字；发现者 Claude-test
- [ ] [16:29] [归属车道 C] 【中】AI 在线但上游慢或不通时，「载入新生示例」最长要等约 23 秒（/ai/__config 3s + chat 20s，400/422 重试共用同一截止时间），现场会一直显示"解析中"；复现：配置一个不响应的 AI_BASE_URL，进入 EP01 点「载入新生示例」；建议：示例按钮直接用 planner.parseItemsText（结果确定、与单测一致），只有观众手输清单才走 AI；或由 D 给 aiParseItems 加一个 6–8s 的演示超时参数；发现者 Claude-test
- [x] [16:29] [归属车道 B] 【中】"两摞书"被当作 2 本书：只生成 1 摞、高 5cm，观众说"几摞书"时腾桌效果明显变小；复现：parseItemsText('两摞书') → 1 件，size.h = 5（tests/demo-flow.test.js 有 todo 用例）；建议：单位为"摞"时 qty 表示摞数，直接生成 qty 摞完整高度的书；发现者 Claude-test
- [ ] [16:29] [归属车道 C] 【中】待机演示在 60 秒无输入后自动接管，路演讲解或评委问答时停顿超过 1 分钟就会切话并改写当前画面，观众的第一下点击会被吞掉；复现：进入任意话后 60 秒不碰鼠标键盘；建议：路演时只允许手动点「待机演示」启动（或 idleMs 调到 5 分钟、仅在 EP00 且未有用户操作时自动启动）；发现者 Claude-test
- [ ] [16:29] [归属车道 C] 【中】main() 没有 .catch，也没有 window 的 error / unhandledrejection 兜底：启动链任一步抛错只会在控制台留下未捕获异常，页面停在半渲染状态，没有任何提示；复现：让 boot 或 mountMonitor 抛错（见上一条场景抛错的例子）；建议：main().catch(err => 在 #app 显示"启动失败，按 F5 重试"并保留文字面板)，并注册 unhandledrejection 写入 alert；发现者 Claude-test
- [x] [16:29] [归属车道 D] 【低】AI 路径匹配到物品库时没有回退库里的 months：normalize 只用 AI 返回的 months，模型对外套、夏凉被常返回 []，于是 AI 在线和离线时 EP03 的季节物品不同（外套全年占挂杆，换季演示变少）；复现：AI 返回 {"name":"外套","months":[]} → item 无 months，而 makeItem('coat').months 为 [9,10,11,3,4,5]；建议：months 为空且 base 有 months 时用 base.months（与 preferred、hang、growthPerSemester 的回退方式一致）；发现者 Claude-test
- [16:32] [D 已修复] AI 解析带“大概 / 大约 / 左右”的库内物品时，原先会把估计尺寸提升为 product、丢失 sizeRange；现保留用户近似提示、AI 尺寸和 estimated，并不据此推定行李箱内容积。新增两项回归覆盖模型误报 product、模型 estimated、准确规格不受影响，以及 planMoveIn 的 uncertain/tolerance。浏览器独立页用合成 AI 响应验证 source=ai、53×37×31cm 收纳箱为 estimated。另修复代理测试临时端口：Vite 6 忽略 port:0 并回退5173，现直接让底层 HTTP 服务监听0，避免并行副本抢占。默认 npm test 已通过；当前项目单独统计149项，146 pass / 0 fail / 3既有todo，生产构建成功；发现者 D。
