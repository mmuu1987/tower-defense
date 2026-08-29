# 三境守卫 · Tri-Realm Defense

Three.js 3D 塔防游戏：**4 个世界 × 每世界 10 关共 40 关**，难度随世界与关卡递增；
阴影 + 自定义泛光 + ACES 色调映射的画面管线；骨骼动画敌人、粒子/屏震/飘字/合成音效/顿帧的打击感；
主菜单、选关（星级锁）、建造升级、暂停、结算、教学、设置与进度存档齐全的中文界面。

**线上试玩**：<https://mmuu1987.github.io/tower-defense-3d/>
**源码仓库**：<https://github.com/mmuu1987/tower-defense>（发布仓 = dist 产物：<https://github.com/mmuu1987/tower-defense-3d>）

## 素材致谢（均免费许可）

- [Kenney](https://kenney.nl/) Nature Kit / Tower Defense Kit —— 植被、装饰、塔武器（CC0）
- [three.js](https://threejs.org) 官方示例模型 RobotExpressive / Horse / Soldier / Xbot / 鸟类 —— 敌人（CC0，作者 Tomás Laulhé 等）
- [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) —— Fox（CC0）
- CesiumMan —— [Cesium](https://github.com/CesiumGS/glTF-CesiumMan)，CC-BY 4.0
- BrainStem —— Microsoft，CC-BY 4.0（via [glTF-Sample-Models](https://github.com/KhronosGroup/glTF-Sample-Models)）
- three.js r160（MIT）—— 渲染引擎

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
- **建造**：点击底部塔坞或按 `1-5` 选择塔，再点击草地放置；右键/Esc 取消。
- **五座塔**：箭塔(速射单体) / 炮塔(范围溅射·不对空) / 寒霜塔(冰环减速) /
  特斯拉塔(闪电链) / 狙击塔(远射穿甲)。每塔可升 2 次，出售返还 70%。
- **敌人十二种**：哥布林、疾行者、重甲兽(护甲)、蝠翼(飞行)、萨满(治疗)、裂变体(死亡分裂)、
  灵狐(高速)、烈焰鸟(飞行)、干尸行者(重甲)、苍鹳(飞行)、舞械偶；
  每世界第 10 关有特色 Boss（狂暴冲锋 / 死亡裂变 / 周期护盾 / 沙暴法老·死亡召唤）。
- **四大世界**：翠绿平原 · 熔岩火山 · 霜雪冰原 · 黄沙戈壁，6 张路径地图轮换。
- **经济**：击杀赏金 + 波次奖励金；三星标准=满生命通关。
- **提前开战**：波间休整期点 ⏩ 按钮（或空格/回车）立即召唤下一波，
  按剩余秒数获得奖励金——少几秒布阵窗口换经济，高手向博弈。
- **波次强度**：同一关内越后的波次敌人越硬（预览条的 ⚔️× 倍率），
  数量随难度缓增；别只顾前期布阵，后期才是硬仗。
- **操作**：WASD/中键拖拽平移 · 滚轮缩放 · Q/E 旋转 · Esc 暂停 · ⏩ 切换 1x/2x/3x 倍速。

## 开发工具

| 命令 | 用途 |
|---|---|
| `node tools/sim.mjs` | 纯逻辑平衡模拟器：Node 里跑完 40 关矩阵输出胜负表 |
| `node tools/smoke.mjs` | 无头冒烟测试：加载+自动战斗+零错误断言 |
| `node tools/shot.mjs --out=x.png` | CDP 无头截图（等首帧信号） |
| `Invoke-WebRequest http://127.0.0.1:8137/healthz` | 服务器健康检查 |
| `GET /api/logs?n=50` | 查看客户端运行时报错 |

## 结构

- `index.html`(importmap) → `js/main.js`（状态机：菜单/选关/战斗）
- `js/engine/` 渲染器·泛光后处理·天空·相机·地形·装饰；`js/game/` 配置·图鉴·关卡生成·战斗实体
- `js/core/` 错误上报·存档·音效引擎；`js/ui/` HUD·飘字·界面覆盖层·结算
- `TASK_STATE.md` —— 开发状态与恢复清单（会话中断后按此恢复）
