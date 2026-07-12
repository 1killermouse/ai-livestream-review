# 本地文件与可复现说明

GitHub 仓库包含运行项目所需的全部自有源码、锁定依赖、空环境模板、数据库迁移和初始化脚本。以下文件只存在于开发者本机，因此直接下载仓库后不会完全相同。

## 为什么有些目录没有上传

| 本地内容                    | 不上传原因                           | 恢复方式                               |
| --------------------------- | ------------------------------------ | -------------------------------------- |
| `.env.local`                | 包含 API Key、OSS 凭证和本地身份信息 | 从 `.env.example` 创建并填写自己的密钥 |
| `node_modules/`             | 体积大、与操作系统相关               | `npm ci --ignore-scripts`              |
| `tools/DouyinLiveRecorder/` | 独立开源项目，不复制上游源码         | `npm run setup:local` 下载固定提交     |
| `dist/`                     | 可重复生成的构建产物                 | `npm run build:prod`                   |
| `.local/`                   | 上传缓存、录屏和任务运行数据         | 运行时自动生成                         |
| `logs/`                     | 可能包含本地路径和业务内容           | 运行时自动生成                         |
| `*.tsbuildinfo`             | TypeScript 本地缓存                  | 类型检查时自动生成                     |

不要为了让目录看起来一样而上传 `.env.local`、录屏、日志或 `node_modules`。

## 复现当前开发环境

```bash
git clone https://github.com/1killermouse/ai-livestream-review.git
cd ai-livestream-review

# 严格按照 package-lock.json 安装 Node 依赖
npm ci --ignore-scripts

# 创建 .env.local，下载固定版本录制器并安装 Python 依赖
npm run setup:local

# 填写自己的云服务密钥后，独立启动前后端
npm run dev:standalone
```

`dev:standalone` 会从 `.spark/meta.json` 推导应用路径，并且只在本地开发进程中注入固定测试身份和 CSRF Cookie，不需要妙搭登录或私人预览 Session。该逻辑不会在 `dev:local`、沙箱或生产构建中启用。

只看完整示例时，可以跳过录制器安装：

```bash
cp .env.example .env.local
npm run dev:standalone
```

## 固定版本

- Node 依赖：由 `package-lock.json` 锁定。
- Node.js：要求 22+。
- DouyinLiveRecorder：固定到 `add187f8d8c7ff7d231fcbee45cbb4f1ed247d3a`。
- Embedding 默认模型：`text-embedding-v4`，1024 维。
- ASR 默认模型：`paraformer-v2`。

云模型属于外部服务，即使代码和模型名相同，供应商更新模型后也可能出现小幅输出差异。确定性“完整示例”不依赖外部模型，适合验证界面和报告结构。
