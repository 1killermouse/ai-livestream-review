# DouyinLiveRecorder 接入说明

## 本地目录

推荐直接运行项目提供的初始化命令：

```bash
npm run setup:local
```

该命令会把直播录制工具下载到：

```text
tools/DouyinLiveRecorder
```

本项目通过环境变量引用它：

```bash
DOUYIN_LIVE_RECORDER_PATH=./tools/DouyinLiveRecorder
DOUYIN_LIVE_RECORDER_PYTHON=./tools/DouyinLiveRecorder/.venv/bin/python
```

该目录是外部开源工具 checkout，已经加入 `.gitignore`，不会作为本项目业务代码提交。初始化脚本会固定到本项目验证过的提交：

```text
add187f8d8c7ff7d231fcbee45cbb4f1ed247d3a
```

## 工具来源

GitHub：

```text
https://github.com/ihmily/DouyinLiveRecorder
```

用途：

```text
输入直播链接 -> 调用 DouyinLiveRecorder -> 生成本地直播录屏文件
```

后续链路：

```text
本地录屏文件
  -> OSS
  -> 阿里 ASR 带时间戳转写
  -> RAG + 违禁词 + 整改建议
```

## 依赖

该工具要求：

- Python >= 3.10
- ffmpeg
- `tools/DouyinLiveRecorder/requirements.txt` 中的 Python 依赖

接真实录制前，需要安装 Python 依赖并确认 ffmpeg 可用。

`npm run setup:local` 会自动创建 `.venv` 并安装 `requirements.txt`。只想下载并校验录制器源码时，可以运行：

```bash
npm run setup:local -- --skip-python
```

## MVP 使用方式

第一版不改 DouyinLiveRecorder 源码，采用外部进程调用：

1. 后端收到直播链接和录制时长。
2. 临时写入 DouyinLiveRecorder 的 URL 配置。
3. 临时修改录制配置，把输出目录指向 `.local/recorder-runs/<runId>`。
4. 以子进程方式运行 `main.py`。
5. 主播下播时录制器自动退出；达到最长保护时长时由后端停止进程。
6. 恢复 DouyinLiveRecorder 原始配置。
7. 从本次输出目录寻找视频/音频文件。

开发接口：

```text
POST /api/recorder/capture
```

请求体：

```json
{
  "liveUrl": "https://live.douyin.com/example",
  "durationSeconds": 21600
}
```

返回值会包含：

```text
status
outputDir
files[]
logs[]
errorMessage
```

第一版不做：

- 长时间值守。
- 多直播间并发录制。
- Cookie 管理后台。
- 平台级稳定性保障。
- 断流续录。

## 注意

只允许用户分析自己有权限处理的直播内容。
