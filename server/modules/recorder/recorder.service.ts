import { Injectable } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import type {
  RecorderCaptureRequest,
  RecorderCaptureResult,
  RecorderOutputFile,
} from '@shared/api.interface';

const VIDEO_EXTENSIONS: Set<string> = new Set([
  '.mp4',
  '.ts',
  '.flv',
  '.mkv',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
]);

@Injectable()
export class RecorderService {
  private running: boolean = false;
  private readonly jobs: Map<string, RecorderCaptureResult> = new Map();

  async captureLive(
    request: RecorderCaptureRequest,
  ): Promise<RecorderCaptureResult> {
    if (this.running) {
      throw new Error('当前已有直播采集任务在运行，请稍后再试');
    }

    const liveUrl: string = this.validateLiveUrl(request.liveUrl);

    const durationSeconds: number = this.normalizeDuration(
      request.durationSeconds,
    );
    const runId: string = `rec-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const outputDir: string = path.join(this.getRunRoot(), runId);
    const job: RecorderCaptureResult = {
      id: runId,
      liveUrl,
      durationSeconds,
      status: 'recording',
      outputDir,
      files: [],
      logs: ['录制任务已启动。主播下播后会自动保存录屏文件。'],
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(runId, job);
    this.running = true;
    void this.runCaptureJob(job);

    return this.cloneJob(job);
  }

  async getCaptureStatus(id: string): Promise<RecorderCaptureResult> {
    const job: RecorderCaptureResult | undefined = this.jobs.get(id);
    if (!job) {
      throw new Error('未找到录制任务');
    }

    if (job.status === 'recording') {
      job.files = await this.findOutputFiles(job.outputDir);
    }

    return this.cloneJob(job);
  }

  private async runCaptureJob(job: RecorderCaptureResult): Promise<void> {
    const logs: string[] = job.logs;

    try {
      await fsp.mkdir(job.outputDir, { recursive: true });
      const recorderDir: string = this.getRecorderDir();
      const configPath: string = path.join(recorderDir, 'config/config.ini');
      const urlConfigPath: string = path.join(
        recorderDir,
        'config/URL_config.ini',
      );
      const originalConfig: string = await fsp.readFile(configPath, 'utf8');
      const originalUrlConfig: string = await fsp.readFile(
        urlConfigPath,
        'utf8',
      );

      await this.writeRecorderConfig({
        configPath,
        originalConfig,
        outputDir: job.outputDir,
      });
      await fsp.writeFile(urlConfigPath, `${job.liveUrl}\n`, 'utf8');

      try {
        const processResult: { exitCode: number | null; timedOut: boolean } =
          await this.runRecorderProcess({
            recorderDir,
            durationSeconds: job.durationSeconds,
            logs,
          });
        logs.push(
          processResult.timedOut
            ? '已到达最长保护录制时间，停止采集进程。'
            : `直播录制进程已退出，退出码：${processResult.exitCode ?? 'unknown'}`,
        );
      } finally {
        await fsp.writeFile(configPath, originalConfig, 'utf8');
        await fsp.writeFile(urlConfigPath, originalUrlConfig, 'utf8');
      }

      const files: RecorderOutputFile[] = await this.findOutputFiles(
        job.outputDir,
      );
      job.files = files;
      job.status = files.length > 0 ? 'completed' : 'failed';
      job.errorMessage =
        files.length > 0
          ? undefined
          : '未找到录制文件。可能是直播未开播、链接失效或平台限制。';
    } catch (error: unknown) {
      job.status = 'failed';
      job.errorMessage =
        error instanceof Error ? error.message : '直播采集任务失败';
      logs.push(job.errorMessage);
    } finally {
      job.finishedAt = new Date().toISOString();
      job.logs = logs.slice(-80);
      this.running = false;
    }
  }

  private getRecorderDir(): string {
    const configuredPath: string =
      process.env.DOUYIN_LIVE_RECORDER_PATH || './tools/DouyinLiveRecorder';
    return path.resolve(process.cwd(), configuredPath);
  }

  private validateLiveUrl(value?: string): string {
    const liveUrl: string = value?.trim() || '';
    if (!liveUrl) {
      throw new Error('直播链接不能为空');
    }
    if (liveUrl.length > 2048 || /[\r\n]/.test(liveUrl)) {
      throw new Error('直播链接格式不正确');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(liveUrl);
    } catch {
      throw new Error('请输入完整的直播链接');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('直播链接仅支持 HTTP 或 HTTPS');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('直播链接不能包含账号或密码');
    }
    return parsedUrl.toString();
  }

  private getPythonPath(recorderDir: string): string {
    const configuredPath: string | undefined =
      process.env.DOUYIN_LIVE_RECORDER_PYTHON;
    if (configuredPath) {
      return path.resolve(process.cwd(), configuredPath);
    }

    const localPython: string = path.join(recorderDir, '.venv/bin/python');
    return fs.existsSync(localPython) ? localPython : 'python3';
  }

  private getRunRoot(): string {
    return path.resolve(process.cwd(), '.local/recorder-runs');
  }

  private normalizeDuration(value?: number): number {
    const maxDurationSeconds: number = this.getMaxDurationSeconds();
    if (!Number.isFinite(value)) {
      return maxDurationSeconds;
    }
    return Math.max(60, Math.min(maxDurationSeconds, Math.floor(value)));
  }

  private getMaxDurationSeconds(): number {
    const configuredDuration: number = Number(
      process.env.DOUYIN_LIVE_RECORDER_MAX_SECONDS,
    );
    if (Number.isFinite(configuredDuration) && configuredDuration > 0) {
      return Math.max(60, Math.floor(configuredDuration));
    }
    return 6 * 60 * 60;
  }

  private cloneJob(job: RecorderCaptureResult): RecorderCaptureResult {
    return {
      ...job,
      files: job.files.map(
        (file: RecorderOutputFile): RecorderOutputFile => ({
          ...file,
        }),
      ),
      logs: [...job.logs],
    };
  }

  private async writeRecorderConfig(options: {
    configPath: string;
    originalConfig: string;
    outputDir: string;
  }): Promise<void> {
    let content: string = options.originalConfig;
    const replacements: Array<[string, string]> = [
      ['是否跳过代理检测(是/否)', '是'],
      ['直播保存路径(不填则默认)', options.outputDir],
      ['保存文件夹是否以作者区分', '否'],
      ['保存文件夹是否以时间区分', '否'],
      ['保存文件夹是否以标题区分', '否'],
      ['保存文件名是否包含标题', '否'],
      ['视频保存格式ts|mkv|flv|mp4|mp3音频|m4a音频', 'mp4'],
      ['是否使用代理ip(是/否)', '否'],
      ['循环时间(秒)', '10'],
      ['是否显示循环秒数', '否'],
      ['分段录制是否开启', '否'],
      ['录制完成后自动转为mp4格式', '否'],
      ['追加格式后删除原文件', '否'],
      ['生成时间字幕文件', '否'],
      ['是否录制完成后执行自定义脚本', '否'],
      ['直播状态推送渠道', ''],
      ['开播推送开启(是/否)', '否'],
      ['关播推送开启(是/否)', '否'],
    ];

    for (const [key, value] of replacements) {
      content = this.replaceIniValue(content, key, value);
    }

    await fsp.writeFile(options.configPath, content, 'utf8');
  }

  private replaceIniValue(content: string, key: string, value: string): string {
    const escapedKey: string = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern: RegExp = new RegExp(`^(${escapedKey}\\s*=).*$`, 'm');
    const replacement: string = `$1 ${value}`;
    if (pattern.test(content)) {
      return content.replace(pattern, replacement);
    }
    return `${content.trimEnd()}\n${key} = ${value}\n`;
  }

  private runRecorderProcess(options: {
    recorderDir: string;
    durationSeconds: number;
    logs: string[];
  }): Promise<{ exitCode: number | null; timedOut: boolean }> {
    return new Promise((resolve) => {
      const pythonPath: string = this.getPythonPath(options.recorderDir);
      const child: ChildProcessWithoutNullStreams = spawn(
        pythonPath,
        ['main.py'],
        {
          cwd: options.recorderDir,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
        },
      );
      let settled: boolean = false;
      let timedOut: boolean = false;

      const appendLog = (chunk: Buffer): void => {
        const lines: string[] = chunk
          .toString('utf8')
          .split(/\r?\n/)
          .map((line: string): string => line.trim())
          .filter(Boolean);
        options.logs.push(...lines);
        if (options.logs.length > 120) {
          options.logs.splice(0, options.logs.length - 120);
        }
      };

      child.stdout.on('data', appendLog);
      child.stderr.on('data', appendLog);

      const timeout: NodeJS.Timeout = setTimeout(() => {
        timedOut = true;
        this.stopProcess(child);
      }, options.durationSeconds * 1000);

      child.on('error', (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        options.logs.push(error.message);
        resolve({ exitCode: null, timedOut });
      });

      child.on('close', (code: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ exitCode: code, timedOut });
      });
    });
  }

  private stopProcess(child: ChildProcessWithoutNullStreams): void {
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGTERM');
        return;
      }
      child.kill('SIGTERM');
    } catch {
      child.kill('SIGKILL');
    }
  }

  private async findOutputFiles(
    outputDir: string,
  ): Promise<RecorderOutputFile[]> {
    const files: RecorderOutputFile[] = [];
    await this.walkOutputFiles(outputDir, files);
    return files.sort(
      (left: RecorderOutputFile, right: RecorderOutputFile): number =>
        new Date(right.modifiedAt).getTime() -
        new Date(left.modifiedAt).getTime(),
    );
  }

  private async walkOutputFiles(
    dir: string,
    files: RecorderOutputFile[],
  ): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries: fs.Dirent[] = await fsp.readdir(dir, {
      withFileTypes: true,
    });
    await Promise.all(
      entries.map(async (entry: fs.Dirent): Promise<void> => {
        const fullPath: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.walkOutputFiles(fullPath, files);
          return;
        }
        if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          return;
        }
        const stats: fs.Stats = await fsp.stat(fullPath);
        files.push({
          path: fullPath,
          name: entry.name,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }),
    );
  }
}
