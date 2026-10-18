# D 车道 · AI 接入与集成（Codex）

- **拥有**：`vite.config.js`、`src/ai/**`、`.env.example`、`README.md`
- **规格**：`docs/08-ai-integration.md`。第二批文档到位前，按本卡先做 D1。
- **安全红线**：key 只存在于 `.env.local` 和开发服务器进程里。不打印 key，不发给前端，不写进任何文件。
- **独立测试页**：可以建 `src/ai/__dev__.html` + `__dev__.js`（一个文本框 + 按钮，显示解析结果和 source），访问 http://localhost:5173/src/ai/__dev__.html ，不依赖 C 车道外壳。
- **`.env.local` 由人类手动填写**。智能体不要读取、打印或复制任何 key，也不要去读 `~/.codex` 下的配置文件：对话记录最后要公开。

---

## D1 代理与客户端（15 分钟）

- [x] `vite.config.js`：
  - 用 `loadEnv(mode, process.cwd(), '')` 读取 `AI_*` 变量。它们没有 `VITE_` 前缀，所以不会进前端包。
  - `server.proxy['/ai/v1']` 转发到 `AI_BASE_URL`，rewrite 去掉 `/ai/v1` 前缀。
  - 在 `configure(proxy)` 里监听 `proxyReq`，设置请求头 `Authorization: Bearer ${AI_API_KEY}`。
  - 写一个小插件，`configureServer` 中间件响应 `GET /ai/__config`，返回 `{ enabled, model, wire, vision }`。**不返回 key。**
- [x] `src/ai/client.js`：`chat(messages, { json = true, timeoutMs = 20000, images })`。
  - 按 wire 选择请求体格式，`chat` 或 `responses`（docs/08 §3）
  - 返回纯文本
  - 超时或 4xx/5xx 时抛出带 `code` 的错误
- [x] `src/ai/index.js`，导出：
  - `aiAvailable()`：请求一次 `/ai/__config` 并缓存结果
  - `aiParseItems`、`aiParsePhoto`、`aiExplainPlan`：后两个先抛 `{ code: 'NOT_IMPLEMENTED' }`

**验收**：没有 `.env.local` 时，`aiAvailable()` 返回 false，页面不报错；有 `.env.local` 时，能拿回一段文本。

## D2 自然语言导入（15 分钟）

- [x] `aiParseItems(text, { owner })`：
  - 提示词要求见 docs/08 §4：只输出 JSON，字段受限
  - 拿到结果后：解析 JSON（容错去掉 ```json 包裹）→ 逐项校验字段、裁剪非法值
  - 与物品库合并：能匹配到 `LIBRARY` 的用库里的尺寸，sizeSource 设为 `'product'`；AI 估计的尺寸设为 `'estimated'`
  - 失败或超时：自动回退到 `parseItemsText(text, { owner })`，`source = 'rules'`，并在 `warnings` 里写明原因
  - 返回 `{ items, source, warnings }`
- [x] UI 只显示"AI 离线，已使用本地解析"，不把技术错误暴露给观众。

## D3 照片导入（加分）

- [x] `aiParsePhoto(file, { owner })`：
  - 用 canvas 把图片压缩到长边 1024，转成 JPEG base64
  - 发给视觉模型，输出格式和 D2 一样
  - `vision` 为 false 时，直接返回 `{ items: [], source: 'unavailable' }`

## D4 集成与交付（15:55 起）

- [x] 按 `docs/01-story-pitch.md` §5 的演示脚本完整走一遍。发现的问题写进 `tasks/BUGS.md`，标明属于哪条车道，由该车道修。
- [x] `README.md`（作品包也用这份）写清：
  - 解决什么问题、主要功能
  - 运行方法、必要环境
  - 如何现场演示
  - 目录结构
  - 第三方清单
- [x] 提交前跑一次密钥扫描（docs/10 §4），配合人类整理 `submission/` 下的文件。
