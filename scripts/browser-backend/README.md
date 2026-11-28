# 后台浏览器

第一次使用时，在本仓库 master 分支创建 Codespace。等待开发容器安装完成，在「端口 / Ports」里打开 6080「后台浏览器」，在桌面里的 Chromium 登录 Facebook。如果桌面提示 VNC 密码，桌面组件的初始值是 `vscode`。请保持 6080 私有。

登录后，在 Codespace 终端运行一次：

```bash
bash scripts/browser-backend/connect.sh
```

这条命令会将查询接口 4318 转为可访问，将其地址写入 master 的 `.github/ad-browser.json`。只有仓库指定的 GitHub Actions 工作流可以向接口发起采集。若 GitHub CLI 缺少修改端口权限，可从 Ports 中将 4318 的 Port Visibility 设为 Public、6080 保持 Private，再运行命令。若仓库要求 PR，按该文件格式通过 PR 保存地址。

以后启动同一个 Codespace，从原 GitHub Pages 查询页搜索即可。切换账号时，在查询结束后打开 6080，在 Facebook 中切换到要使用的账号。查询在同一浏览器的独立标签页运行。桌面关闭了浏览器时，可运行 `bash scripts/browser-backend/start.sh` 重新打开。停止 Codespace 会暂停查询，原浏览器配置保存在仓库外的 `/workspaces/.tucoiva-browser/profile`。删除 Codespace 会删除这份配置。
