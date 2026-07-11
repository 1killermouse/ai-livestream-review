# Security Policy

## Supported Version

当前只维护 `main` 分支上的最新版本。

## Reporting a Vulnerability

请使用 GitHub 仓库的 **Security > Report a vulnerability** 私下提交安全问题，不要在公开 Issue 中披露漏洞细节。

报告中请包含：

- 受影响的模块或接口。
- 可复现的最小步骤。
- 可能影响的数据和使用场景。
- 建议修复方向（如有）。

请不要附带真实 API Key、AccessKey、Cookie、直播签名 URL、个人信息或未经授权的直播内容。可以使用脱敏值和本地样例复现。

## Current Security Boundary

本项目当前是个人作品集与单机 MVP，尚未提供认证、租户隔离、限流、审计日志和生产级任务队列。请勿在未补齐这些能力前直接作为公网生产服务运行。
