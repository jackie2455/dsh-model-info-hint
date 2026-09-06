# dsh-model-info-hint

一个 DeepSeek Harness（DSH）插件：在 Web GUI 的模型选择器里，只要把鼠标光标悬停在某个待选模型上，就会在该模型旁弹出一个提示，展示该模型的详细配置信息——可接收的输入类型（`text`、`image` 等）、上下文窗口、最大输出 tokens、推理级别，以及所属服务商的协议（`api`）、`baseURL` 与认证环境变量名（`apiKeyEnv`）。

配置信息来源于用户的 settings 文档（默认 `~/.dsh/settings.yaml`，或 `$DSH_HOME/settings.yaml`），通过 DSH 自带的 settings 服务读取——因此自动支持 `$DSH_HOME` 覆盖、热加载以及 `.yaml`/`.json` 两种格式。

## 工作原理

插件分两半，模式与 `dsh-archived-conversation` 一致：

- **Host 侧**（`lib/index.js`）：注入 `settings` 与 `webServer` 服务，注册同源 JSON 接口
  `GET /model-info-hint/api/models`，一次性返回 settings 文档中所有模型的完整配置，
  以 `(provider 显示名, model 显示名)` 作为查找键。
- **浏览器侧**（`lib/client.js`）：监听全局 `mouseover`。当鼠标悬停在模型选择器的某个
  模型项上时（同时支持输入框的模型按钮菜单和 `/model` 弹窗），按该模型项的可见文本在映射中
  查到配置，并在光标旁渲染一个非阻塞的详细提示。

settings 文档中模型路由的典型结构（`llm-pi-ai` 命名空间）：

```yaml
llm-pi-ai:
  providers:
    my-provider:
      displayName: 我的服务商       # 可选：默认用 key 作为显示名
      api: openai-completions       # 可选：线路协议
      baseURL: https://example/v1   # 可选：服务端点
      apiKeyEnv: MY_API_KEY         # 可选：认证环境变量名
      defaultInput:                # 可选：provider 级兜底
        - text
        - image
      models:
        - id: gpt-5.4-nano
          name: 我的服务商 | gpt-5.4-nano   # 可选：默认用 id
          contextWindow: 400000     # 可选：上下文窗口
          maxTokens: 32768          # 可选：最大输出
          input:                   # 可选：模型级覆盖，优先级最高
            - text
            - image
          reasoningEfforts:        # 可选：推理级别
            high: high
            low: low
```

输入类型解析顺序：模型自身 `input` → provider `defaultInput` → `["text"]`。查找是通用的：插件会扫描
所有已注册 settings 命名空间的 `providers` 字典，因此不限于 `llm-pi-ai`，任何按此结构存储路由的
适配器都能命中。

## 安装

把本目录作为本地包加入 `web` profile（或你实际使用的 profile），然后重启 DSH：

```sh
# 从本地路径安装
dsh plugin --profile web add file:/absolute/path/to/dsh-model-info-hint

# 之后重启 web 界面使新插件生效
dsh web
```

如果插件已发布到 npm，也可以直接：

```sh
dsh plugin --profile web add dsh-model-info-hint
dsh web
```

安装后无需任何配置：打开模型选择器（输入框的模型按钮，或 `/model` 命令），把鼠标悬停在模型上即可
看到详细配置提示。

## 目录结构

```
dsh-model-info-hint/
├── package.json        # dsh.client / dsh.bundle 声明
├── cordis.patch.yml    # 在 profile 中激活插件行
├── lib/
│   ├── index.js        # host 侧：读 settings + 暴露 HTTP 接口
│   └── client.js       # 浏览器侧：悬停检测 + 详细配置提示
└── README.md
```

## 备注

- 提示是非阻塞的（`pointer-events: none`），不会挡住鼠标悬停或点击。
- 提示会在移出模型、点击、滚动或按任意键时消失，并在 6 秒后自动消失，避免菜单关闭后残留。
- 提示只展示 `~/.dsh/settings.yaml` 里声明过的字段，未显式配置的项（例如继承自目录的
  `contextWindow`）不会显示；`input` 因有 provider/默认兜底，始终会显示。
- `apiKeyEnv` 显示的是环境变量**名称**（例如 `BEEROUTE_KEY_DEFUALT_API_KEY`），不是密钥本身，
  settings 文档里存放的也只是变量名。
- 只覆盖在 settings 文档中声明了模型的适配器；像内置的 `deepseek-official` 这种未在
  `~/.dsh/settings.yaml` 里描述模型的适配器，不会显示提示。
- 界面文案使用中文，输入类型名（`text`/`image` 等）与 settings 文档保持一致。
