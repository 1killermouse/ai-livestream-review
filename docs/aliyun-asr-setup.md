# 阿里 ASR 准备清单

## 你需要准备

1. 开通阿里云百炼 / DashScope。
2. 获取百炼 API Key，填入 `ALIYUN_DASHSCOPE_API_KEY`。
3. 创建 OSS Bucket，用于存放待识别音频。
4. 创建可访问该 Bucket 的 AccessKey，填入 OSS 相关变量。
5. ASR 模型使用 `paraformer-v2`。

至少需要配置：

```bash
ALIYUN_OSS_BUCKET=
ALIYUN_OSS_REGION=
ALIYUN_OSS_ENDPOINT=
```

## 为什么必须有 OSS

阿里录音文件识别不是直接上传本地二进制文件，而是提交一个可访问的音频 URL。

本项目流程是：

```text
直播录制/录屏上传
  -> 上传 OSS
  -> 将 OSS URL 交给阿里 ASR
  -> 轮询任务结果
  -> 下载 transcription_url 里的 JSON
```

## 时间戳要求

本项目必须使用带时间戳的转写结果。解析优先级：

1. 优先使用 `transcripts[].sentences[]`
2. 读取 `begin_time` 和 `end_time`
3. 单位从毫秒转换为秒
4. 保存为统一结构：

```json
{
  "id": "asr-1",
  "startSeconds": 0,
  "endSeconds": 4,
  "text": "这套 AI 课程会讲提示词、工作流和案例拆解",
  "wordCount": 12,
  "matchedStage": "unknown"
}
```

词级时间戳 `words[]` 后续可用于更精细的违禁词定位，MVP 先用句子级时间戳。

## 本地填写方式

复制 `.env.example` 里的变量到 `.env.local`，只填本地文件，不要把密钥发到聊天里。

## 验证接口

后端预留了一个开发验证接口：

```text
POST /api/analysis/transcribe-url
```

请求体：

```json
{
  "fileUrl": "https://你的音频文件地址.wav"
}
```

返回值是系统统一使用的带时间戳片段数组。等 API Key 和 OSS 准备好后，可以先用这个接口单独验证 ASR。

## OSS 上传验证接口

后端也预留了本地文件上传 OSS 的开发接口：

```text
POST /api/storage/upload-local-file
```

请求体：

```json
{
  "localPath": ".local/recorder-runs/xxx/demo.mp4"
}
```

返回值会包含一个可供 ASR 使用的签名 URL：

```json
{
  "objectKey": "zhibo-review/2026-07-08/xxx.mp4",
  "fileUrl": "https://...",
  "expiresSeconds": 172800
}
```
