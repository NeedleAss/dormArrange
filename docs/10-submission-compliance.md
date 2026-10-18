# 10 · 提交与合规

> 负责人：P3（D 车道的人类）。所有要求来自《参赛选手手册》第五节和附件二、附件三。
> **16:35 先传保底版，16:55 前传最终版，17:00 截止。**

## 1. 作品包结构

文件名：**`校园学习生活+<队名>+方寸.zip`**，即"赛道 + 队名 + 作品名"。

```
校园学习生活+<队名>+方寸.zip
├─ 源码/                  ← git archive 导出的仓库（不含 node_modules、dist、.env.local）
├─ README.md              ← 与仓库根目录的 README 相同：解决什么问题、功能、运行方法、环境、现场演示方法
├─ 队伍介绍.md             ← 由 submission/队伍介绍.md 填写
├─ 开源与AI使用声明.md      ← 由 submission/开源与AI使用声明.md 填写，后面贴上全部 AI 对话
└─ 允许后续开源.md          ← 由 submission/允许后续开源.md 填写，全体队员确认
```

可以对照组织方的示范文件夹：https://cloud.tsinghua.edu.cn/d/7d8ac1c2103a45929339/

## 2. AI 使用声明流程（16:35 开始，约 15 分钟）

1. **找出所有参与开发的 AI 窗口**：
   - claude.ai 上的总架构对话（就是写这些文档的这一个）
   - 每个 Codex 窗口（A、C 车道）
   - 每个 Claude Code 窗口（B、D 车道）
   - 用过的其他网页对话模型，如有也算
2. **在每个窗口的最后发送附件三的统一自查提示词**。
   - 必须**原样**复制，不能改动一个字。
   - 请直接从**组织方发的手册原件**里复制，不要从本仓库或聊天记录里转抄，以免出现字符差异。
3. 如果某个窗口看不到最终源码或其他对话，就保留它回答的"无法核查"说明，不要让 AI 补造记录。
4. **导出每个窗口的完整对话**：
   - Claude Code：可以用 `/export`；不支持的话就在终端里全选复制。
   - Codex：在终端里全选复制；本地会话记录一般在 `~/.codex/sessions/` 下。
   - claude.ai：在网页上全选复制。
5. **队长汇总**：在 `开源与AI使用声明.md` 开头写一段不超过 200 字的《开源与 AI 使用声明》，内容包括：
   - 主要引用来源
   - 复用方式
   - 本队新增的核心内容
   - Git 历史简况
   - 仍未核实的部分
6. 把所有窗口的完整对话按窗口顺序贴在后面。**贴之前先搜索 key**（§4）。

## 3. Git 历史简述（写进声明）

用下面的命令看提交记录，概括成几句话即可，不要粘贴完整日志：

```bash
git log --reverse --format="%ad %s" --date=format:%H:%M
```

建议写法：

> 13:xx–14:30 搭建框架与文档（总架构）；14:30 起四条车道并行；
> CPx 时完成了……；共 N 次提交，全部为 2026-10-18 现场完成。

## 4. 密钥与隐私扫描（打包前必做）

```bash
# 1) 仓库里不能有 key、.env.local 不能被跟踪
git grep -nE "sk-[A-Za-z0-9]{8,}|AI_API_KEY=.+|Bearer [A-Za-z0-9]" -- . ':!docs/**' ':!*.md' ; echo "exit=$?（1 表示没找到，正确）"
git ls-files | grep -E "^\.env" ; echo "只应看到 .env.example"

# 2) 对话记录里不能有 key：在合并好的 开源与AI使用声明.md 里搜索
grep -nE "sk-[A-Za-z0-9]{8,}|Bearer " 开源与AI使用声明.md ; echo "exit=$?（1 表示没找到）"
```

另外检查 `assets/` 下的照片：人脸、姓名、门牌号是否已打码。

## 5. 打包命令

**macOS / Linux：**

```bash
TEAM="<队名>"
rm -rf pkg && mkdir -p "pkg/源码"
git archive HEAD | tar -x -C "pkg/源码"
cp README.md pkg/
cp submission/队伍介绍.md submission/开源与AI使用声明.md submission/允许后续开源.md pkg/
cd pkg && zip -r "../校园学习生活+${TEAM}+方寸.zip" . && cd ..
```

**Windows PowerShell：**

```powershell
$TEAM = "<队名>"
Remove-Item -Recurse -Force pkg -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "pkg\源码" | Out-Null
git archive --format=zip -o pkg\src.zip HEAD
Expand-Archive pkg\src.zip -DestinationPath "pkg\源码"; Remove-Item pkg\src.zip
Copy-Item README.md, submission\队伍介绍.md, submission\开源与AI使用声明.md, submission\允许后续开源.md pkg\
Compress-Archive -Path pkg\* -DestinationPath "校园学习生活+$TEAM+方寸.zip" -Force
```

> `git archive` 只导出已提交的文件，所以 node_modules 和 `.env.local` 天然不会被带上。
> **打包前确保所有车道都已推送，并且你 pull 到了最新版本。**

## 6. 上传

- **上传入口**：https://cloud.tsinghua.edu.cn/u/d/9ed746f2cfe5452e916a/
- **16:35 保底版**：文件名后加 `-v1`，内容可以不完整，但必须能运行。
- **16:55 最终版**：用最终文件名。上传后**刷新页面确认文件出现、大小正确**。
- 遇到故障立刻找工作人员登记。

## 7. 合规自查清单

- [ ] 作品与抽中的关键词有明确联系，并在 README、队伍介绍和演示中说明（时间空间 / 专注 / 成长）
- [ ] 所有代码都是 10 月 18 日现场开发的，Git 历史可证明
- [ ] 外部内容都已列出来源、用途、修改和许可：three.js、Vite、字体（OFL）、学校规定（转述）
- [ ] 没有原作素材：截图、标志、角色、原作字体、音效
- [ ] 每个 AI 窗口都发过附件三提示词，完整对话已经贴上
- [ ] 没有 API key、账号凭据、个人敏感信息
- [ ] 全体队员确认同意后续开源；原创部分使用 MIT
- [ ] 作品包文件名正确，上传成功
