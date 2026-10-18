# 08 · AI 接入

> 读者：D 车道（实现）、C 车道（调用）。
> 原则：**AI 是加速器，不是依赖。** 没有 key、断网或超时时，产品照样完整可用（规则解析兜底）。

## 1. 用在哪里

| 功能 | 函数 | 优先级 | 不可用时 |
|---|---|---|---|
| 自然语言 → 物品清单 | `aiParseItems` | MVP（D2） | `parseItemsText` 规则解析 |
| 照片 → 物品清单 | `aiParsePhoto` | 加分（D3） | 按钮置灰 |
| 腾桌方案一句话解说 | `aiExplainPlan` | 加分 | 直接显示步骤文案 |

规划算法本身**不依赖 AI**：它是确定性的、可解释的。这一点在答辩时要讲清楚：AI 负责"听懂你"，算法负责"算对"。

## 2. 代理：key 绝不进浏览器

```
浏览器 ──POST /ai/v1/chat/completions──▶ Vite dev server ──(加 Authorization 头)──▶ AI_BASE_URL/chat/completions
浏览器 ──GET  /ai/__config─────────────▶ Vite dev server ──▶ { enabled, model, wire, vision }（不含 key）
```

`vite.config.js` 的要点：

1. 用 `loadEnv(mode, process.cwd(), '')` 读取 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_WIRE_API`、`AI_VISION`。这些变量没有 `VITE_` 前缀，前端拿不到。
2. `server.proxy['/ai/v1']`：
   - target 设为 `AI_BASE_URL` 的 origin
   - rewrite 把 `/ai/v1` 换成 `AI_BASE_URL` 的 path 部分
   - `changeOrigin: true`
   - `configure: (proxy) => proxy.on('proxyReq', (req) => req.setHeader('Authorization', 'Bearer ' + AI_API_KEY))`
3. 写一个内联插件，在 `configureServer` 里注册 `GET /ai/__config` 中间件，返回 JSON：`{ enabled: !!(AI_BASE_URL && AI_API_KEY), model, wire, vision }`。
4. **不要在任何日志里打印 key**，包括代理报错。

> 代理只存在于 `npm run dev`。演示时用 dev server，不用 build 产物。

## 3. 两种协议

先确认能通：在终端里用 Codex 的同一套 base_url 和 key 发一个最小请求（不要把命令连同 key 贴进任何文档或聊天）。确认后在 `.env.local` 里设置 `AI_WIRE_API`。

### 3.1 `AI_WIRE_API=chat` → `POST {base}/chat/completions`

```json
{
  "model": "<AI_MODEL>",
  "temperature": 0,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "<系统提示词>" },
    { "role": "user", "content": "<用户输入>" }
  ]
}
```

- 读取：`choices[0].message.content`。
- 如果服务端拒绝 `response_format`，去掉它重试一次，再靠解析容错处理。
- 图片：把 user 的 content 写成数组：`[{ "type": "text", "text": "…" }, { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } }]`。

### 3.2 `AI_WIRE_API=responses` → `POST {base}/responses`

```json
{
  "model": "<AI_MODEL>",
  "input": [
    { "role": "system", "content": [{ "type": "input_text", "text": "<系统提示词>" }] },
    { "role": "user",   "content": [{ "type": "input_text", "text": "<用户输入>" }] }
  ],
  "text": { "format": { "type": "json_object" } }
}
```

- 读取：优先用 `output_text`；没有时遍历 `output[].content[]`，拼接 `type === 'output_text'` 的 `text`。
- 图片：在 content 里加 `{ "type": "input_image", "image_url": "data:image/jpeg;base64,…" }`。
- 以上字段以实际服务端为准。不通时先用最小请求排查，再调格式。

### 3.3 客户端 `src/ai/client.js`

- 超时用 `AbortController`，默认 20s。
- 错误统一抛出 `{ code: 'TIMEOUT'|'HTTP_4XX'|'HTTP_5XX'|'BAD_JSON'|'DISABLED', message }`。
- 同一段文本（取哈希）在内存里缓存结果，避免重复请求。
- 并发：同一时刻最多 1 个请求。全队与 Codex 共用"并发 ≤ 5"的额度。

## 4. 物品解析：提示词要满足的要求

提示词由 D 车道在现场自己写，放在 `src/ai/prompts.js`。必须做到：

1. **角色和任务**：从中文描述中提取大学生要带进或已放在宿舍里的物品。
2. **只输出 JSON 对象**：`{ "items": [...] }`，不要任何解释文字。
3. **每个物品的字段**（与 docs/04 Item 对齐，但更简化）：

   ```json
   {
     "name": "24寸行李箱",
     "qty": 1,
     "category": "luggage",
     "size_cm": { "w": 42, "d": 26, "h": 66 },
     "size_confidence": "product",
     "freq": "rare",
     "months": [],
     "power_w": null,
     "hangable": false,
     "stackable": false,
     "compressible": false,
     "note": ""
   }
   ```

   - `category` 只能取 docs/04 的 Category 枚举。
   - `size_confidence` 只能取 `product` / `estimated` / `unknown`：用户给了规格或是标准件 → product；靠常识估 → estimated；完全没法估 → unknown，同时仍给一个保守估计。
   - `freq` 只能取 daily / weekly / monthly / seasonal / rare。
   - `months` 是季节性物品的活跃月份。冬季衣物给 11–3 月，夏季物品给 6–9 月，全年使用的给空数组。
4. **尺寸单位是厘米**，按"立着摆放"给出 宽 × 深 × 高。衣物给折叠后的尺寸。
5. **数量**：保留 qty，**不要**自己展开成多条；"20 本书"写成 qty: 20。
6. 用户提到功率时填 `power_w`；没提到但属于电器的填 null。
7. 遇到"不确定、大概、没量过"之类的字眼，`size_confidence` 必须是 `estimated` 或 `unknown`。
8. 给 2–3 条 few-shot 示例，例如一条含行李箱 + 显示器 + 书，一条含功率和不确定尺寸。

## 5. 结果校验与合并：`aiParseItems` 内部

```
raw = 去掉 ```json 包裹后 JSON.parse；失败 → 回退规则解析
for x in raw.items（最多 60 条）:
  category 不在枚举 → 'misc'；freq 不在枚举 → 'weekly'
  尺寸各维截断到 [1, 250]；qty 截断到 [1, 50]；months 只保留 1–12 的整数
  lib = 用 x.name 在 LIBRARY 的别名里找最长匹配
  if lib 且 x.size_confidence !== 'unknown':
     以 makeItem(lib.libId) 为底，size 用库的，sizeSource = 'product'
     （如果用户写了明确的 寸 / cm，就用 AI 给的尺寸，sizeSource = 'product'）
  else:
     sizeSource = x.size_confidence === 'product' ? 'product' : (x.size_confidence === 'unknown' ? 'unknown' : 'estimated')
  flags 由 hangable / stackable / compressible（true 时取 0.4）映射；powerW = x.power_w
  按 qty 展开，规则同 docs/05 §8 ④：书每 10 本合一摞
  分配 id：`ai-${三位序号}`；owner = 调用参数
return { items, source: 'ai', warnings }
```

## 6. 照片导入（加分）

1. 前端用 canvas 把图片缩放到长边 1024px，转成 JPEG（quality 0.8）的 base64。
2. 提示词在 §4 的基础上加三条：
   - 只列出照片中能看清的物品
   - 对每件物品估计尺寸，`size_confidence` 一律为 estimated
   - 额外输出 `position_hint`：left / center / right、front / back，可作为 EP02 乱桌的初始摆放参考
3. `vision` 为 false 时，按钮置灰，提示"当前模型不支持图片"。
4. 隐私：照片只发给 AI 接口，不保存到仓库，也不写进日志。

## 7. 失败与降级

| 情况 | 表现 |
|---|---|
| 没有 `.env.local` | `aiAvailable() = false`；顶栏 AI ● OFFLINE；解析直接走规则 |
| 超时 / 5xx | 自动回退规则解析；警报流推一条 info："AI 离线，已使用本地解析" |
| 返回内容不是合法 JSON | 回退一次规则解析；warnings 记录 'BAD_JSON' |
| 返回 0 件物品 | 回退规则解析；仍为 0 时提示"没有识别到物品" |

## 8. 安全清单

- [ ] `.env.local` 不在 git 里：`git status` 看不到它，`git check-ignore .env.local` 有输出。
- [ ] 前端打包产物里搜不到 key：`npm run build` 后对 `dist/` 做 grep。
- [ ] 截图、录屏里不出现终端中的 key。
- [ ] **AI 对话记录里不出现 key**：所有对话最后都要贴进公开的《开源与 AI 使用声明》，贴之前要搜一遍。
