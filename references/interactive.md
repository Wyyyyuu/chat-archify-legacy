# 交互图与附件工作流

交互附件版是默认完整交付：一个离线 HTML 同时包含可交互框图、节点证据、已选文件快照与对话摘录索引。它适用于普通长对话，也适用于跨任务的项目历史。先按来源证据整理 evolution.json；本技能不会自行读取聊天或自动推断事件。

## 依赖与一键虚构示例

完整生成依赖 Python 3.9 或更新版本、Node.js 18 或更新版本，以及单独安装的 Archify skill。Archify 不随 Chat Archify 打包，也不由示例脚本安装。当前集成只在 Archify 2.17.0-dev.1 上验证；其他版本需重新核验工作流 schema、节点联动和生成结果。上游：[github.com/tt-a1i/archify](https://github.com/tt-a1i/archify)。

在宿主的已安装技能列表或配置的 skills 目录中找到 archify/SKILL.md，阅读它的调用要求；把其所在目录（内含 bin/archify.mjs）作为 --archify-dir。目录含空格时也用引号。无需预先填写示例 JSON 或画图，在 skill 根目录运行：

~~~sh
python scripts/build_interactive_demo.py --archify-dir "<archify-skill-directory>" --out-dir "work/portable-skill-demo"
~~~

脚本把虚构输入复制到输出目录的 source/，依次运行 Archify showcase validate 和 deliver、全连线几何检查、附件打包、Python 资料／拓扑回归及 Node 导航 smoke test。成功入口为 work/portable-skill-demo/chat-archify-demo.html，回执为同目录的 package-receipt.json。不会联网、安装依赖或启动服务。Archify 不存在、版本环境不满足或任一检查失败时，命令非零退出且不会报告成功产物；已有输出不会被当成本轮成功结果。

此 smoke test 使用小型 fake DOM，只验证代码层面的导航行为，不能作为真实浏览器或视觉验收。若宿主允许使用 Archify 自带浏览器采集，可对成功 deliver 的确切 HTML 运行 node "<archify-skill-directory>/bin/archify.mjs" visual-check "<output-html>" --json；将该证据与人工视觉检查分别报告。不要通过另一个浏览器、CDP 或本地 HTTP 服务绕过宿主的本地文件限制。

## 为真实对话准备来源

1. 明确时间、任务／话题范围以及可读取材料。使用 coverage 说明完整记录、选定摘录、摘要或不可访问部分。普通对话可以直接用 project.title 作为话题，不用虚构项目模块。
2. 为每项有证据支持的变化建立稳定节点 ID，保留候选分支、被放弃的方案和有依据的全部关系。不要为通过布局检查删除边。无关系的独立节点合法，记录可使用 edges: []。
3. 在节点 evidence 中引用来源 ID、原始行号／轮次／消息标识；在节点 artifacts 中只列真正由该阶段产生、修改或引用的资源。文件 uri 相对 evolution.json 所在目录。已有 artifact.note 应写清快照含义。未知阶段时间或快照时间留空，不用打包日期补写。
4. 如要生成对话索引，把已有摘录保存为 UTF-8 .md，并在来源中设 kind: "conversation"，用 uri 指向该文件，写明 coverage、locator、title。索引器识别如下标题与元数据；每个消息或摘要可含任务 ID、轮次 ID、消息 ID：

   ~~~markdown
   ## 2026-09-01T09:00 · 用户
   任务 ID：11111111-1111-4111-8111-111111111111
   轮次 ID：aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
   消息 ID：<来源中确有的标识>

   已保存的消息正文……
   ~~~

   标题可用 · 助手 标记助手消息。准确 node↔excerpt 关联要求 evidence locator 包含已保存的轮次 ID 或消息 ID；不要按相同日期猜定位。轮次 ID 相同的消息会组成一轮，同一来源／任务按原顺序链接前后摘录。只有保存下来的部分会出现；不要暗示索引恢复了未提供的上下文。若来源未给出真实原任务链接，就不要拼 Codex 深链。仅 original_url_verified: true 且为无凭据的 HTTPS URL 才显示原任务入口；没有该 URL 时页面明确显示“已保存摘录”，并提供标题与 task ID 供人工定位。

## 生成实际附件页面

在输出目录放置 evolution.json、资源文件和 Archify workflow v2 规格。每个子图不超过约 12 个主要节点；节点 ID 必须与记录 ID 完全相同，箭头方向与每条记录边的 from／to 及重复数一致。使用 meta.quality_profile: "showcase"。如有分支和合并，先完整表达事实，再调整规格布局；保留所有真实关系。

准备 manifest.json，路径均相对 manifest：

~~~json
{
  "title": "项目演进",
  "chapters": [
    {
      "id": "overview",
      "label": "项目总览",
      "record": "evolution.json",
      "viewer": "archify-overview.html"
    }
  ]
}
~~~

从 skill 根目录执行（把占位符替换为实际目录；含空格的路径必须加引号）：

~~~sh
node "<archify-skill-directory>/bin/archify.mjs" validate workflow "<output-dir>/workflow-v2.json" --quality showcase --json
node "<archify-skill-directory>/bin/archify.mjs" deliver workflow "<output-dir>/workflow-v2.json" "<output-dir>/archify-overview.html" --quality showcase --json
python scripts/check_routes.py "<output-dir>/archify-overview.html"
python scripts/package_interactive.py "<output-dir>/manifest.json" "<output-dir>/chat-archify.html"
~~~

交付前须在最终规格上看到完整 9 项 showcase 检查通过、0 composition errors／warnings；deliver 成功后再审查其精确 HTML。补充检查器逐对检测全部正交路由，包括共享节点的边，并拒绝交叉、重合和穿过节点；它只支持正交 SVG M/L 路径，遇到其他几何会报错。打包器额外核对 viewer 与 record 的节点 ID、每条有向边端点及重复数。两者都要求 viewer 已包含所有真实边；不能删边以绕过诊断。合法零边图可通过，但若 viewer 漏了 record 中的边仍会失败。规格修改后需重新 validate、deliver、check 和 package，旧回执不能证明新字节通过。

package_interactive.py 校验记录、文件引用、viewer 几何并生成 SHA-256 回执。输入资源文件按 evolution.json 所在目录解析并嵌入页面；用户浏览的原件不会被页面修改。应核对嵌入字节与来源、Markdown 互链、来源覆盖、章节和所有关系。对既有页面仅刷新 UI 时可用 --snapshot-from <已有交互HTML> 复用既有附件快照；新增文件必须显式刷新来源后打包。

## 完整 UI 行为与限制

- 新页面默认只显示框图。节点点击、键盘激活或阶段选择器打开阅读面板；桌面为并排框图和可关闭侧栏，窄屏显示框图或一个阅读面板。主题切换保留图／阅读模式和已加载的框图状态。
- 面包屑及浏览器后退／前进恢复路线和阅读滚动位置。文件名保留安全的真实资源链接：普通点击在页内读，Ctrl／Command 点击可打开快照链接；另有下载与复制源路径。
- Markdown 默认格式化阅读，保留原文、目录和下载；多段行定位可滚到对应段落并高亮。不能解析或映射的 locator 应解释原因。HTML、代码等文档按文本安全呈现，Markdown 不通过 innerHTML 执行原始内容；远程图片不会自动加载。
- 搜索覆盖阶段、文件正文和对话摘录，结果显示类型与命中上下文；文件正文命中直接定位，摘录命中高亮消息正文。打开结果后保留搜索和结果列表位置。
- 文件的关联阶段从节点 artifacts／evidence 计算；到达文件的导航路线单独写为“从……进入”。不要把路线误写为文件的历史来源。较长正文先显示，关联节点和技术信息在后；展示已有 artifact.note。阶段时间与文件快照时间分开显示，未知时间标作未记录。
- 对话按来源实际提供的任务和轮次分组，显示同源相邻摘录；缺少上下文时明确指出只收录部分。一般 HTTPS 网页只有在来源显式提供并验证后才作原任务链接，不推测 codex:// 格式。
- 交互 HTML 自包含数据与所选附件；本地文件链接不依赖 file:// 子资源、本地服务器或联网服务。页面 CSP 禁止内容网络访问。单个文件超过 25 MB、凭据类型或疑似密钥内容会被排除并说明；目录仅做索引，不自动装入全部内容。允许的图形与文件集合由用户指定范围决定。

若用户环境没有 Archify 或 Node.js，保留原记录并说明完整附件版缺少的依赖。只有用户接受降级或完整版本确实不可用时才执行基础命令：

~~~sh
python scripts/render.py "<output-dir>/evolution.json" --out-dir "<output-dir>"
~~~

这会生成轻量 evolution.html、SVG、Markdown 和 JSON，不包含 Archify 图框、全文件嵌入阅读、跨类型全文搜索或对话轮次索引；不要将它描述为与完整附件版相同。
