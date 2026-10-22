# CONTRIBUTING

欢迎 PR / issue。这个插件的定位很窄：**让 agent 用真浏览器看网页，并且尽量少烧 token**。超出这个定位的功能（增量抓取、站点专用适配器、纯提速的多标签并发）以前被否过，理由写在下面的「改动评审三条」。

## 环境

- Node 22+（DSH 自带的那份也够）
- DSH 0.2.x（宿主 API：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`）
- 一份 Chromium 系内核（Chrome / Edge / Brave / OCS 内置的都行）

```bash
git clone https://github.com/KNLCXY/dsh-browser-kernel.git
cd dsh-browser-kernel
dsh plugin --profile <你的 profile> add "file:$PWD"
# 改 cordis.patch.yml 或 ~/.dsh/storages/browser-kernel/settings.json 里的 chromePath
```

## 目录

```
lib/index.js      宿主半：四个工具、CDP 客户端、代理路由、摘要管线、settings 路由（~2.1k 行）
lib/client.js     client 半：设置面板（settings.section）+ 输入框三档开关（input.dock）
lib/rank.js       搜索词清洗与结果重排（纯函数，最好单测）
test/             不需要 DSH 的纯逻辑测试 + 一个走 asar 的集成自测
bench/            基准脚本（预算、闸门、路由、数值豁免回归）
docs/MANUAL.md    长手册；docs/ARCHITECTURE.md 是内部流程
```

## 自测

```bash
# 纯逻辑（Node 直接跑）
node --test test/

# 集成：用假 ctx 跑 apply()，真的打开网页验证四种 action 和代理模式
ELECTRON_RUN_AS_NODE=1 "<DSH 目录>/DeepSeek Harness.exe" test/test-offline.mjs
```

`test-offline.mjs` 会把源码里的 `@deepseek-ai/dsh-tools` 指向 asar 里的真实实现——这是能脱离 DSH 进程验证宿主半的唯一办法。

改了摘要逻辑，请顺手跑 `bench/bench-final.mjs` 和 `bench/reg-fact.mjs`，把前后数字写进 PR 描述（尤其是 token 数和召回率，别只写「感觉更好了」）。

## 改动评审三条

任何一个新功能，先回答三个问题；**任一为「是」就不做，或改设计直到三条都过关**：

1. **会不会大幅增加 token 消耗？** —— 别按「每一步操作都返回一份摘要」来做，5 步就是 5 倍。正确做法：一次调用批量做完，只返回最终状态的一份摘要。
2. **会不会让上下文不连贯？** —— 分页/懒加载内容要合并成一份，不要产出一堆割裂的中间态。
3. **会不会引入误判？** —— 如果只是「信息缺失」变「信息完整」，不算风险；如果会**猜**选择器、假装点击成功、假装已登录，就必须加校验或不做。

省 token 的改动还要过 ROI 门槛：**预算翻倍至少要换来 8–12 个百分点的准确率/召回率**，否则不值得（+25% 预算换 +6 pp 被否过）。

## 提交前

1. bump `package.json` 的 `version`（patch 位就够，除非改了行为）
2. 更新 `CHANGELOG.md`
3. 重新装进 profile 并**重启 DSH**（client 半在启动时组装一次）

```bash
dsh plugin --profile <profile> add "file:$PWD"
```

pnpm 是把包**复制**进 `node_modules`，版本号不变时它会直接说 "Already up to date"，不会重新拷贝——所以不 bump 等于没改。

## 代码风格

- ESM，无构建步骤，**零运行时依赖**（CDP 用 Node 内置 `WebSocket`，别引 Playwright/Puppeteer）
- 中文注释贴着实现写，说明「为什么」而不是「做了什么」
- 宿主半里所有会抛的操作都要有兜底：工具返回错误文本比抛异常更好，agent 能自己换路
- 给用户看的字符串用中文；给模型看的参数描述也要写清边界（默认值、取值范围、什么时候别用）
