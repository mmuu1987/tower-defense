# 视觉资产交接文档（ART HANDOFF）

> 交接日期 2026-08-29。接手对象：具备图像生成/视觉设计能力的模型或人员。
> 前任说明：上一轮的素材是"实机截图 + 程序化 Canvas 文字合成"，工程上完整（管线可复现、像素校验通过），
> 但美术水准有限，用户不满意视觉效果。**底图采集、技术管线、验收工具都已就绪，缺的是真正的美术设计。**

---

## 一、一句话任务

为 4399 平台提审的 H5 塔防游戏《三境守卫》制作**游戏图标**与**宣传图**，替换现有
`release/4399/art/` 下的程序化合成版（规格见下表），用户目测满意即验收。

| 交付物 | 尺寸 | 格式 | 数量 | 用途 |
|---|---|---|---|---|
| 游戏图标 | 512×512 正方形 | PNG | 1 | 4399 平台上传（各档位自动缩放，需在 ~50px 下仍可辨识） |
| 宣传图 | 1280×720 | PNG | 4-5 | 平台游戏页展示（主视觉 1 张 + 各世界/功能若干） |
| （可选）主菜单标题图 | 横版，透明底优先 | PNG | 1 | 游戏内主菜单 Logo 位（见第八节） |

**注意**：这些素材是平台元数据，**不进游戏 zip 包**，放 `release/4399/art/` 即可。

---

## 二、项目速览（接手者需要的最少背景）

- 项目路径：`E:\Project\TestDeepseek\tower-defense`（Windows，Node v26，无需 npm install）
- 本地运行：`node tools/serve.mjs` → **http://127.0.0.1:8137/**（已配置后台常驻可直接访问）
- 游戏本体：Three.js 低多边形 3D 塔防，4 世界 ×10 关，5 种塔，12 种敌人 + 4 Boss
- 游戏名：**三境守卫**（备选：三国守卫战/塔防三境/守卫三境）
- 一句话简介：3D 塔防守城：四大世界 40 关，12 种敌人 4 大 Boss，五塔布阵守卫传送门！
- 线上版（可游玩参考）：https://mmuu1987.github.io/tower-defense-3d/

---

## 三、游戏视觉设定（写提示词/做设计直接取用）

### 3.1 世界观与四大世界（色彩气质）

| 世界 | 主题色 | 氛围关键词 |
|---|---|---|
| 翠谷草原（世界1） | 草绿 + 晴空蓝 | 明快、清新、入门教学 |
| 熔岩荒地（世界2） | 暗红 + 熔岩橙 + 焦黑 | 压抑、危险、熔火之心 Boss |
| 霜寒要塞（世界3） | 冰蓝 + 雪白 | 冷冽、晶莹、冰霜君王 Boss（周期护盾） |
| 黄沙戈壁（世界4） | 沙金 + 蓝天 | 苍茫、遗迹、沙暴法老 Boss（金色法老+干尸军团） |

### 3.2 核心视觉元素

- **防御塔 5 种**（均有 3 级，升级加金色等级刻度）：
  箭塔（木质弩炮·棕金）/ 炮塔（加农炮·蓝灰·溅射）/ 寒霜塔（冰蓝水晶·减速光环）/
  特斯拉塔（紫电球·闪电链）/ 狙击塔（绿钢长枪管·穿甲）
- **敌人 12 种**（低模卡通骨骼动画）：哥布林（绿机器人）、疾行者（马）、重甲兽（灰蓝重甲机器人）、
  蝠翼（紫鹦鹉·飞行）、萨满（青绿士兵·治疗）、裂变体（粉紫机器偶·死亡分裂）、
  灵狐（橙狐·高速）、烈焰鸟（粉红火烈鸟·飞行）、干尸行者（米白干尸）、苍鹳（白鹳·重型飞行）、
  舞械偶（蓝白机械舞者）
- **Boss 4 个**：丛林巨兽（巨型绿机器人·狂暴）、熔火之心（赤红巨人·死亡裂变）、
  冰霜君王（深蓝君王·周期护盾）、沙暴法老（金色法老·召唤干尸）
- **标志性意象**：发光传送门（红色=敌人进攻终点，必须守住）、蜿蜒土路、
  低模树木/岩石/仙人掌/冰晶等环境装饰
- **美术风格总结**（可直接用于提示词）：bright stylized low-poly 3D, cartoony tower defense,
  clean silhouette, vivid saturated colors, soft bloom lighting, Kenney-asset style, casual game key art

### 3.3 游戏 UI 配色（做图保持品牌一致性用）

- 金色主色 `#ffcc55`（金币/标题/强调）、生命红 `#ff5d5d`、成功绿 `#59d97a`、
  警示橙 `#ffb347`、强调蓝 `#57a9ff`、深底 `#0b1220`/`#121a2b`
- 中文标题字体环境：Windows 有微软雅黑（Bold/Black 可用）；游戏内 UI 即微软雅黑

---

## 四、可复用资产清单（现成底图，免重拍）

`logs/art/raw-*.png`（1280×720 实机渲染摆拍，无 HUD 纯净画面，除 ui-feature 外）：

| 文件 | 内容 |
|---|---|
| `raw-meadow-hero.png` | 翠谷草原：13 塔沿螺旋路布阵，丛林巨兽 Boss + 12 敌军行军，弹幕/闪电特效在飞 |
| `raw-lava-boss.png` | 熔岩荒地漩涡图：熔火之心 Boss + 重甲/裂变体/飞行群 |
| `raw-frost-boss.png` | 霜寒要塞之字图：冰霜君王（护盾微光）+ 干尸/苍鹳/萨满 |
| `raw-sand-boss.png` | 黄沙戈壁：沙暴法老 + 干尸/灵狐/火烈鸟军团 |
| `raw-ui-feature.png` | 完整游戏界面（HUD 在）：提前开战按钮、下一波预览条、塔坞、选中塔面板 |

这些可直接作为合成底图/垫图参考，也可以用第五节的方法重拍任意新角度。
现有成品（**待替换**的程序化版本，规格/命名沿用）：`release/4399/art/`。

---

## 五、实机摆拍技术手册（需要新底图时）

已有工具 `tools/make-art.mjs`（生成器）与 `tools/shot.mjs`（单截图）。摆拍原理：无头浏览器进真实
关卡 → 注入脚本放塔/刷怪/调相机 → 截图。**可拍出任意世界、任意阵容、任意角度的游戏画面。**

### 5.1 摆拍脚本核心 API（在游戏页面 eval，需等 `window.__TD_READY` 且 `__TD_DEBUG.battle()` 非空）

```js
const b = __TD_DEBUG.battle();   // 战斗实例
const rig = __TD_DEBUG.rig;      // 相机
b.gold = 99999;                  // 放开经济限制
// 沿路放塔：sampler.at(里程) 取路径点 → 换算格子 cx=round(x+10.5), cz=round(z+7)
//   b.selectedType='tesla'; b.tryPlace(cx,cz)===true 后 b.towers.at(-1) 可连续 upgradeTower 升级
// 刷怪：b.spawnEnemy('bossSand') / 任意敌人 key（见 js/game/units.js ENEMY_DEFS/BOSS_DEFS）
//   随后 e.dist=里程; e.maxHp=e.hp=999999（锁血让塔一直开火敌人不死）; e.baseSpeed=0.42（慢速行军）
// 相机：rig.pitch=0.8(俯角0.5~1.1); rig.yaw=任意; rig.dist=11~16(越近越特写)
//   rig.cur.yaw/rig.cur.dist/rig.cur.focus.set(x,0,z) 必须同写（平滑值立即落位）
// 隐藏 HUD：document.getElementById('hud').style.display='none'（+ #fps）
```

### 5.2 已知坑（都踩过，别再踩）

1. **Edge 无头视口陷阱**：`--window-size=1280,720` 实际视口是 **1256×627**（差 24×93 的浏览器装饰）。
   必须在 CDP 连接后立刻 `Emulation.setDeviceMetricsOverride {width:1280,height:720,deviceScaleFactor:1,mobile:false}`。
2. **Canvas 跨域污染**：about:blank 页里加载本地 PNG 会 taint 画布（getImageData 报错）。
   解法：Node 读文件 → base64 **dataURL 注入** eval（make-art.mjs 已实现）。
3. **截图用 clip**：`Page.captureScreenshot {clip:{x,y,width,height,scale:1}}` 精确出图尺寸。
4. **敌人模型懒加载**：页面启动时 `preloadEnemyModels` 预载全部模型，等 `__TD_READY` 后再睡 1.4s
   才 spawn，否则拿到的是程序化替身（色块小人）。
5. 结算/胜利后 battle 不再更新——摆拍要趁 state 还在（build/intermission 都行，敌人手动 spawn 照常
   被塔索敌开火）。

### 5.3 校验工具

`tools/verify-art.mjs`：无头加载产物 PNG 按区域采样亮/金像素断言（标题、角标、按钮等）。
做新图后可改 CHECKS 里的区域/阈值跑一遍，防"画布有但截图没有"这类坑。
`tools/art-hist.mjs <png路径>`：任意 PNG 的区域 x 直方图，调区域坐标用。

---

## 六、推荐做法（按接手模型能力二选一或组合）

### 路线 A：图像生成模型出 Key Art（推荐做图标与主视觉）

- 图标：以"塔 + 传送门 + 盾"等核心意象做扁平/微立体徽章式设计，避免复杂场景缩图糊掉。
  参考提示词方向：`stylized tower defense game icon, low-poly castle tower with glowing portal,
  crossed arrow and cannon, shield emblem, vibrant green/blue fantasy palette, mobile game icon style,
  clean bold shapes, centered composition`（中文游戏名"三境守卫"可后期叠字或省略）
- 主视觉 banner：可用第四节实机底图做垫图/参考，生成后叠游戏名与标语（叠字若生成模型做不好，
  交回程序化管线：make-art.mjs 的 gradText/chip 函数可直接复用）
- 各世界 banner：按 3.1 的四世界色彩分别出图

### 路线 B：程序化合成升级版（若接手模型擅长前端/Creative Coding）

保留实机底图，把 `tools/make-art.mjs` 合成部分重做：真正的 Logo 字体设计（非通用黑体）、
构图层次、光效、描边质感。第五节全部基础设施照用。

### 验收标准（用户口径）

1. 目测构图/配色/信息传达满意（前任败因：合成感重、字体普通、构图平）
2. 图标缩到 50×50 仍可辨识
3. 宣传图带游戏名"三境守卫"，文字清晰
4. 尺寸精确（512² / 1280×720），PNG，文件名沿用现有命名直接覆盖

---

## 七、版权红线（4399 审核）

- 生成素材须可商用（注意生成模型的商用授权条款）
- 若引用第三方素材仅限 CC0 或 CC-BY（CC-BY 需在 `release/4399/提交材料.md` 致谢节补署名）
- 宣传图**不得含**外链、二维码、联系方式（4399 硬性要求）
- 游戏内现有素材致谢清单见 `release/4399/提交材料.md` 第三节

---

## 八、可选延伸需求（用户未明确要求，提审后可谈）

- 主菜单标题画面：目前是 DOM 文字，可做一张横版 Key Art + Logo 提升"第一眼品质"
- favicon / index.html `<title>` 配套小图标（16/32/180）
- 加载屏（首屏 three.js 初始化期间）
- 结算弹窗星级特效装饰

---

## 九、环境速查

| 事项 | 命令/位置 |
|---|---|
| 启动服务器 | `node tools/serve.mjs`（127.0.0.1:8137，可能已在后台运行，`/healthz` 探活） |
| 重新生成程序化素材 | `node tools/make-art.mjs`（`--only=stage` 只摆拍 / `--only=compose` 只合成） |
| 像素校验 | `node tools/verify-art.mjs` |
| 单张截图 | `node tools/shot.mjs "--url=http://127.0.0.1:8137/?level=0,2" --out=x.png --settle=5000` |
| 数值/单位图鉴 | `js/game/units.js`（敌人）、`js/game/towers.js`（塔）、`js/game/config.js`（世界主题） |
| 提交材料 | `release/4399/提交材料.md`（上传流程/自查表/致谢） |
| 项目历史 | `TASK_STATE.md`（所有轮次记录，接手前扫一眼最后一节） |

> 交接备忘：交付后请把产物覆盖到 `release/4399/art/`，更新 `提交材料.md` 第五节表格与
> `TASK_STATE.md`，并在回复用户时提示其目测验收（用户是唯一视觉验收人）。
