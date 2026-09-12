# 三境守卫 · Tri-Realm Defense

Three.js 3D 塔防游戏：**5 个世界 × 每世界 10 关共 50 关**，难度随世界与关卡递增；
阴影 + 自定义泛光 + ACES 色调映射的画面管线；骨骼动画敌人、粒子/屏震/飘字/合成音效/顿帧的打击感；
主菜单、选关（星级锁）、建造升级、暂停、结算、教学、设置与进度存档齐全的中文界面。

**线上试玩**：<https://mmuu1987.github.io/tower-defense-3d/>
**源码仓库**：<https://github.com/mmuu1987/tower-defense>（发布仓 = dist 产物：<https://github.com/mmuu1987/tower-defense-3d>）

## 当前改造计划

[大地图战斗系统全面改造方案](GAMEPLAY_OVERHAUL_PLAN.md)：攻击算法、金币经济、塔与怪物成长、技能体系，以及新增 6 种塔至至少 11 种。包含建议设计、G0 至 G5 实施阶段、代码落点、验收标准和跨模型接手清单。

**当前本地状态（2026-09-11）：G0 至 G2 已实施，七塔八级，箭塔/毒蚀塔/指挥塔技能闭环可玩。** 十一塔、怪物等级和经济重构尚未完成，下一阶段为 G3。先读方案与 [TASK_STATE.md](TASK_STATE.md) 的当前目标部分；历史线上地址不是本轮新版本，本轮未部署。验证记录见 [G2 验证报告](docs/G2_VERIFICATION.md)。

## 素材致谢（均免费许可）

- [Kenney](https://kenney.nl/) Nature Kit / Tower Defense Kit —— 植被、装饰、塔武器（CC0）
- [three.js](https://threejs.org) 官方示例模型 RobotExpressive / Horse / Soldier / Xbot / 鸟类 —— 敌人（CC0，作者 Tomás Laulhé 等）
- [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) —— Fox（CC0）
- CesiumMan —— [Cesium](https://github.com/CesiumGS/glTF-CesiumMan)，CC-BY 4.0
- BrainStem —— Microsoft，CC-BY 4.0（via [glTF-Sample-Models](https://github.com/KhronosGroup/glTF-Sample-Models)）
- three.js r160（MIT）—— 渲染引擎
- Lucide（ISC；部分图标 MIT）导航、缩放与技能操作图标，许可见 `vendor/lucide/LICENSE`；本轮新增图标固定为 0.468.0，原始许可另存 `vendor/lucide/LICENSE-0.468.0`

## 运行

```powershell
cd tower-defense
npm start          # 或 node tools/serve.mjs
# 打开 http://127.0.0.1:8137/
```

素材下载（可选，失败也有程序化回退材质）：

```powershell
node tools/download-assets.mjs   # 断点续传 + 重试，可反复执行
```

## 玩法

- **目标**：阻止敌人沿路径抵达红色传送门。20 点生命归零即失败。
- **建造**：点击底部塔坞或按 `1-7` 选择已解锁的塔，再点击合法空地放置；右键或取消按钮退出建造。
- **七座塔**：原五塔箭/炮/寒霜/特斯拉/狙击保留；新增毒蚀塔（W1-7 解锁，叠层毒伤/抑疗）和指挥塔（W2-1 解锁，友军光环/技能支援）。原五塔保持开局可用。
- **八级成长**：七塔均可升至 Lv.8，出售按累计实际投入返还 70%。目前箭塔、毒蚀塔、指挥塔在 Lv.4 解锁招牌技能、Lv.6 选 A/B 专精、Lv.7 强化专精、Lv.8 解锁终阶技能；其余四塔的技能和专精留待 G4。
- **技能**：默认自动施放，可在选中塔面板关闭终阶自动并点击施放；`Z` 招牌、`X` 终阶、`F` 切换终阶模式。只在战斗中对有效目标施放；暂停冻结冷却、毒伤和毒云。升级解锁技能从完整冷却开始，后续升级不重置已有冷却。
- **普通敌人十一种**：哥布林、疾行者、重甲兽(护甲)、蝠翼(飞行)、萨满(治疗)、裂变体(死亡分裂)、
  灵狐(高速)、烈焰鸟(飞行)、干尸行者(重甲)、苍鹳(飞行)、舞械偶；
  每世界第 10 关有特色 Boss（狂暴冲锋 / 死亡裂变 / 周期护盾 / 沙暴法老·死亡召唤）。
- **五大世界**：翠谷草原 · 熔岩荒地 · 霜寒要塞 · 黄沙戈壁 · 幽暗墓园。50 关独立路线，其中 20 关分岔汇流；选关页显示实际路线缩略图。
- **大地图**：战场从 22×15 扩大为 42×28 格，面积约为原来的 3.56 倍；路线与地形铺满新范围，塔、敌人、路宽和格子尺寸不变。
- **地形**：溪流、熔沟、冰裂隙、干河床与墓园湿地，配合桥梁、岩壁、成组树林和遗迹；道路、水域与地标不可建塔。地图固定种子，重试时布局不变。
- **经济**：击杀赏金 + 波次奖励金；三星标准=满生命通关。
- **提前开战**：波间休整期点 ⏩ 按钮（或空格/回车）立即召唤下一波，
  按剩余秒数获得奖励金——少几秒布阵窗口换经济，高手向博弈。
- **波次强度**：同一关内越后的波次敌人越硬（预览条的 ⚔️× 倍率），
  数量随难度缓增；别只顾前期布阵，后期才是硬仗。
- **操作**：WASD/中键拖拽平移 · 滚轮缩放 · Q/E 旋转 · Esc 暂停 · ⏩ 切换 1x/2x/3x 倍速。
- **小地图**：左下角显示道路、敌人、塔与当前视野；点击或拖动定位，按钮缩放或回到全图。小地图聚焦时，方向键移动视野，回车/空格回到全图。手机建造和选塔时自动收起，避免遮挡。

## 开发工具

| 命令 | 用途 |
|---|---|
| `npm test` | 100 项地图、战斗、八级成长、费用、技能、毒伤、光环、倍速、暂停及资源释放回归 |
| `node tools/map-browser-check.mjs` | 五种主题及桌面、手机横竖屏截图、像素、桥面、小地图导航、缩放、触屏和双路战斗检查；需安装 Playwright，见脚本头部 |
| `node tools/sim.mjs` | 纯逻辑平衡模拟器：Node 里跑完 50 关矩阵输出胜负表 |
| `node tools/sim.mjs 1 8 --g2 --branch=B` | 新塔阵容与 B 专精策略，记录等级和技能次数；未解锁塔回退为箭塔 |
| `node tools/sim.mjs 2 4 --seconds=900` | 加长模拟时间预算，区分长路线耗时与卡死；默认预算仍为 600 秒 |
| `node tools/growth-browser-check.mjs` | 四视口真实升级/专精/手动技能/暂停/出售检查，截图及毒云显隐像素差检查 |
| `node tools/smoke.mjs` | 无头冒烟测试：加载+自动战斗+零错误断言 |
| `node tools/shot.mjs --out=x.png` | CDP 无头截图（等首帧信号） |
| `Invoke-WebRequest http://127.0.0.1:8137/healthz` | 服务器健康检查 |
| `GET /api/logs?n=50` | 查看客户端运行时报错 |

## 结构

- `index.html`(importmap) → `js/main.js`（状态机：菜单/选关/战斗）
- `js/engine/` 渲染器·泛光后处理·天空·相机·地形·装饰；`js/game/` 配置·图鉴·关卡生成·战斗实体
- `js/core/` 错误上报·存档·音效引擎；`js/ui/` HUD·飘字·界面覆盖层·结算
- `GAMEPLAY_OVERHAUL_PLAN.md` —— 当前大地图战斗改造目标、内容设计、实施阶段与验收清单
- `TASK_STATE.md` —— 开发状态与恢复清单（会话中断后按此恢复）
