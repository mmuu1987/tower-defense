# 部署指南

游戏是**纯静态网页**（无需后端），任何静态托管都能跑。已预置三条免费路线。

## 现状：已部署 GitHub Pages ✅

- **线上地址**：<https://mmuu1987.github.io/tower-defense-3d/>
- 仓库：<https://github.com/mmuu1987/tower-defense-3d>（内容 = dist 构建产物，main 分支根目录）

### 更新线上版本（一条命令）

```powershell
node tools/deploy-pages.mjs
```

自动完成：重新打包 dist → git 提交推送 → GitHub Pages 1-2 分钟内自动重建。
无改动时会提示跳过。

## 备选方案

### itch.io（游戏平台风格，带评论/点赞页）

1. 登录 <https://itch.io/> → 头像 → Upload new project
2. Kind of project 勾选 **HTML**；上传 `tri-realm-defense-web.zip`（由
   `node tools/build-dist.mjs` + `Compress-Archive -Path dist\* -DestinationPath tri-realm-defense-web.zip` 生成）
3. 勾选 "This file will be played in the browser"，Viewport 尺寸填 1280×720
4. Save & view page —— 完事

### Cloudflare Pages（全球 CDN 最快）

```powershell
npx wrangler login          # 浏览器授权一次
npx wrangler pages deploy dist --project-name=tri-realm-defense
```

得到 `https://tri-realm-defense.pages.dev`；更新重复第二条命令即可。

## 注意事项

- 许可：Kenney 资源 CC0（可商用免署名）、three.js MIT——发布无合规负担
- 本地验证部署包：`$env:PORT='8138'; $env:TD_ROOT="…\dist"; node tools/serve.mjs`
  然后 `node tools/smoke.mjs "http://127.0.0.1:8138/?auto=1&level=0,0" 20000`
- 客户端错误上报 `/api/log` 仅本地服务器可用；静态托管上该请求静默失败，
  不影响游戏（排查线上问题用浏览器 F12 控制台）
