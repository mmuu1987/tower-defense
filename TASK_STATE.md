# 任务状态（供跨轮次 / 会话中断后恢复使用）

> 恢复口诀：新会话先读本文件 → 执行「恢复清单」→ 按「里程碑进度」从第一个未勾选项继续。

## 目标摘要
在 `tower-defense/` 构建完整可玩 3D 塔防（Three.js r160）：3 世界 × 10 关共 30 关、难度递增；
画质（阴影/泛光/主题化场景）、打击感（粒子/屏震/飘字/音效/顿帧）、中文友好界面与存档；
素材联网免费获取且下载器可断点续传；本地服务器带健康检查与错误上报；最终冒烟测试通过。

## 一键恢复清单（每个工作轮开始时执行）
1. `node -v` 确认 Node 可用（v26.7.0 已验证）。
2. 启动/确认服务器：后台运行 `node tools/serve.mjs`（端口 8137）。
3. `Invoke-WebRequest http://127.0.0.1:8137/healthz` 返回 `"ok":true` 即正常。
4. 素材补齐（幂等）：`node tools/download-assets.mjs`（断点续传+重试，已存在自动跳过）。
5. **视觉验证**：`node tools/shot.mjs --out=logs/shot.png` —— CDP 无头截图，
   页面首帧渲染完成（`window.__TD_READY=true`）后才截图；页面致命错误走 `window.__TD_FATAL`。
   然后用读图工具查看 PNG 确认画面。
6. 客户端报错查看：`GET /api/logs?n=50`（写入 logs/client.log）。
7. 环境坑：无嵌套 pwsh；PowerShell 是 5.1 按 ANSI 读脚本——工具一律用 Node(.mjs)，
   .ps1 里不要写中文注释。

## 架构现状
- 入口：index.html(importmap three→/vendor) → js/main.js（boot.js 为降级自检页备用）
- js/core/errors.js 全局错误上报；js/engine/{renderer,bloom,sky,camera,terrain,decor}.js
- js/game/config.js（GRID/THEMES×3/QUALITY_PRESETS）、js/game/maps.js（3 张路径布局循环复用）
- 后处理：自研 PostFX——场景HDR RT(MSAA4) → 亮度提取 → 半分辨率高斯(H/V×2) → 合成(ACES+gamma+泛光)
- 相机：CameraRig（WASD/中键平移、滚轮缩放、Q/E旋转、指数平滑）
- 地形：贴图地面(带程序化回退)、路径丝带(斜接关节)、出入口发光传送门、pathCells 集合
- 装饰：按主题散布 InstancedMesh（树/岩/花/冰晶/枯树/熔岩池），emissive 呼吸动画

## 里程碑进度
- [x] M1 脚手架：服务器/下载器/自检页/素材全下载（three r160 1.27MB + 4 纹理）
- [x] M2 引擎底座：渲染管线+自定义泛光+ACES、RTS相机、天空穹顶、地形路径、主题装饰、
      CDP 截图验证通过（logs/shot-m2b.png：草地+S径+双传送门+树木岩石，无运行时错误）
- [x] M3 核心玩法：units/towers 图鉴+程序化造型、levelgen(30关曲线：波数6→15、HP×1→34.6、
      金×4.2、解锁池、Boss波)、battle(波次队列/经济/建造升级出售/胜负判定)、
      Enemy 沿路径移动+血条+受击闪白+减速染色、Tower 索敌转塔开火（直射/迫击炮预判抛物线/
      冰环减速/闪电链）、FxLayer（火花/冲击环/闪电/枪口点光池）、hud-lite（资源条/塔坞/面板/横幅）。
      无头验证：kills=2 且金币精确吻合、敌人带伤行军、第30关Boss波配置正确、三主题渲染正常
- [x] M4 打击感：AudioEngine(WebAudio 合成 18 种音效 + 三主题生成式 BGM，节流防炸)、
      Floaters(DOM 飘字：伤害/金币/暴击/信息)、FxLayer 升级为 GPU 粒子池
      (1600 点精灵+加法混合+重力弹跳+泛光提亮)、顿帧(Boss 死亡 0.3s / 爆炸 0.05s dt×0.16)、
      受创红闪边缘、金币脉冲、静音按钮、建造尘土。
      无头验证：粒子爆发+伤害数字"14"+金币飘字入镜（logs/shot-m4.png），kills=1 经济吻合，
      全程日志零错误。注意：本轮曾出现一次 audio.js 写入丢失（不可抗力），已重写并 grep 验证。
- [x] M5 界面：save.js(localStorage td_save_v1 星级/设置/教学标记+解锁链)、
      主菜单(标题/继续冒险带进度/环绕运镜背景)、世界选关页(3页签×10格·星级锁·Boss皇冠·⭐计数)、
      结算弹窗(三星弹入动画/下一关链/重玩)、暂停菜单(Esc)+共用设置面板(音量滑条/画质三档即时生效)、
      建造射程圈预览(合法绿/非法红/选中塔白圈)、数字键1-5选塔、新手教学步骤条、速度按钮文案同步。
      截图验证：主菜单/选关(模拟6星解锁链正确)/战斗回归(auto模式combat)/胜利弹窗。
      ⚠ 本轮再次出现幽灵写入(save.js 报成功未落盘)——后续每轮对关键新文件做 HTTP HEAD 抽查。
- [x] M6 内容与平衡：tools/sim.mjs 纯逻辑模拟器(node_modules/three 本地别名→vendor，
      无需 npm 安装)——**借此发现并修复重大 Bug：startWave 守卫把 intermission 状态拒之门外，
      导致第 2 波永远无法开始(自动与手动均失效)**；平衡迭代 6 轮：HP 曲线 1.13^d→1.085^d、
      赏金 1.05^d→1.085^d、新增波次奖励金(60+波×10)、同波间隔 0.45→0.72 拉开血量洪峰、
      塔强化(箭塔 dps+30%/冰环减速 .48/炮溅射 1.7)、护甲治疗下调；
      最终基线机器人世界0 4胜多关惜败末波=人类可三星；Boss 三技能落地
      (丛林狂暴加速/熔火死亡裂变4小怪/冰霜周期护盾含吸收与微光)；熔岩主题装饰调优截图确认
- [x] M7 稳健性：tools/smoke.mjs 冒烟测试 **PASS ✓**(首帧渲染/战斗推进/建塔≥2/波次推进/
      客户端零报错 五项断言)；README 完整玩法说明；index.html 加最早错误捕获(html-error)；
      30 关 buildLevel 全部通过模拟器实跑验证

## 终态摘要（2026-08-22）
游戏完整可玩：http://127.0.0.1:8137/ —— 菜单→选关(星级解锁)→30 关递增难度→结算存档。
冒烟测试 `node tools/smoke.mjs` 为交付门槛，任何后续改动跑一遍即可回归。

## 打磨轮（第二轮长任务）2026-08-22
- [x] B1 Bug修复：胜利横幅自动移除(2.6s)；enterBattle 先 exitBattle（修复重玩/下一关残留旧塔+旧HUD）；
      相机 yaw 归位（菜单环绕角度残留致视角歪斜）；地面平面加大(+40/+34)防边缘穿帮
- [x] B2 资源升级：Kenney Nature Kit(10MB)+Tower Defense Kit(5MB) CC0 抓取成功（fetch-kenney.mjs）；
      精选 32 模型平铺 assets/models/（pick-models.mjs）；vendor GLTFLoader+BufferGeometryUtils；
      importmap 加 addons 映射；js/engine/modellib.js：fetch+parse、归一化(居中/贴地/按高缩放)、
      克隆共享几何、失败超时回退程序化。**审计揪出关键陷阱：names.map(loadOne) 把数组索引
      当 timeoutMs → 全体 0ms 超时**；修复后 21/21 模型 94ms 加载完成
- [x] B3 植被地形：橡树/松树/灌木/草丛/蘑菇/三色花模型化(草原)；雪树/冰晶呼吸光(霜原)；
      树桩圆木(熔岩)；纯石三型随机混排+熔岩世界克隆材质压暗；路缘石沿路径点缀；
      五塔 Kenney 武器模型(弩炮/加农炮/机枪塔/水晶簇/大水晶)+主题染色辨识
- [x] B4 审计修复：弹道几何/材质缓存化(修 GPU 泄漏)；Tower.dispose 阻止异步模型替换；
      modellib Node 环境守卫(保 tools/sim.mjs 可用)；node_modules/three 别名包 addons 子路径转发
- [x] B5 回归终验：sim.mjs 胜率 4/30 与基线一致(纯逻辑零影响)；smoke.mjs PASS(含熔岩世界)；
      草原/熔岩/五塔特写截图确认

## 验证工具备忘
- `node tools/shot.mjs "--url=.../?level=W,L&auto=1" --out=x.png --settle=35000 --eval="表达式"`
  —— settle=就绪后继续模拟的毫秒数（关键参数）；--eval 可读 window.__TD_SNAP()/__TD_DEBUG(.battle/.ui)
- battle.snapshot() 含 state/gold/lives/wave/enemies/towers/kills/leaks/speed
- __TD_SAVE(存档对象)/__TD_SELECT.refresh()(刷新选关)/__TD_ENTER(w,l)(直接进关)
- 写文件后必须抽查：`Invoke-WebRequest ... -Method Head` 确认非 404（防幽灵写入）

## 视觉深度升级轮（第三轮长任务）2026-08-22
- [x] C1 敌人模型：Quaternius 页面无直链（走兜底）；three.js 官方动画模型
      RobotExpressive/Horse/Soldier/Xbot/三只鸟 → 覆盖 7 类敌人+3 Boss（体型/染色区分，
      Boss 加大 2.2-2.8 倍）；SkeletonUtils vendor；fetch-enemies.mjs 抓取脚本
- [x] C2 动画接入：modellib loadEnemyTemplate/makeEnemyInstance（SkeletonUtils 克隆保骨架、
      每实例材质克隆供闪白/减速/护盾发光、动画名正则匹配 Walk/Run/gallop/flap/Death）；
      Enemy 混入 mixer/actions/yawOff；行走速度联动移速；死亡序列 startDeath→播 Death 或沉没缩小；
      battle 清理改为 disposed 标记制（尸体动画播完才移除）。**修坑：模型相对路径层级算错
      （../models → ../../assets/models/enemies）静默回退，已加错误上报**
- [x] C3 地面环境：分段平面+顶点色双层噪声渐变+轻微起伏（破平铺）；路径三层化
      （泥土肩带/深描边/砖石路面）+路面碎石 70 颗 InstancedMesh；地图四周 Kenney cliff 围边
      （随机缺省自然感）；飘动云层 12 片柔边云板（createClouds）
- [x] C4 摆放物体：草原远古遗迹(方尖碑/石柱/石环)、熔岩篝火(石圈+木柴)、霜原冰封遗迹(冰染)，
      PRELOAD 扩至 27 个模型
- [x] C5 特效升级：爆炸焦痕贴花池(20 块循环渐隐)、冲击波膨胀球、死亡灵魂光柱(按体型变高)、
      弹道拖尾火花(箭矢蓝白/炮弹橙/子弹亮黄，28ms 限频)、冰霜寒雾上飘粒子(负重力)、受击缩放弹跳
- [x] C6 回归与部署：sim 胜率 4/30 与基线一致；smoke 本地+**公网**双 PASS；
      **修复 deploy-pages/build-dist 全量删除 dist/.git 导致无法更新的 Bug**（保留 .git +
      deploy 自愈式 init+强推）；新版本已发布 https://mmuu1987.github.io/tower-defense-3d/

## 缓存排查 + 地形强化（断线续跑轮）2026-08-22
- [x] 线上核验：live JS/模型均为新版 → 用户"没变化/怪物不显示"主因 = GitHub Pages
      10 分钟浏览器缓存（玩到旧 bundle）；已提醒 Ctrl+F5 强刷
- [x] 全类型敌人体检探针（spawn 9 种+逐实例 mixer/scale/meshes）——全部正常，
      Boss 键为 meadow/lava/frost（探针曾用错名虚惊）
- [x] 地形可见度大幅增强：大块色斑(biome patch)低频渐变×暗色 lerp、振幅 0.14→0.14+patch 0.55、
      起伏 0.06→0.22 且**路径区自动压平**（distToPath 衰减）、悬崖围边更近更密更高(3.3/8%/1.25-1.95)、
      云层保留；草原/熔岩双主题截图确认差异显著
- [x] 回归：sim 胜率 4/30 基线一致；smoke 本地+公网双 PASS；**新版已发布线上**
      （commit eaf2d2b）

## 用户实测反馈修复轮 2026-08-22
- [x] **重大 Bug 根因定位：Horse.glb 等动画自带 root motion（位移轨道）——骨骼动画在
      模型内部"向前跑"，随时间累积偏离逻辑位置 → 塔按逻辑位置索敌 = 打空气、
      视觉上模型"消失"。修复：模板加载时剥离全部 .position 轨道（保留旋转/缩放，
      clip.resetDuration），原地跑步由逻辑位置驱动**
- [x] 马朝向再修正：+π/2 → -π/2（root motion 曾掩盖真实朝向）；全类型体检探针确认
      Boss 键实为 meadow/lava/frost（此前探针用错名虚惊）
- [x] 地形可见度增强：大块色斑(biome patch)低频渐变、起伏 0.22 且路径区 distToPath 自动压平、
      悬崖围边更近更密更高；双主题截图确认差异显著
- [x] 线上核验：live JS/模型均为新版；用户"没变化/怪物不显示"主因=Pages 10 分钟浏览器缓存
      （需 Ctrl+F5）；sim 4/30 基线一致 + smoke 本地/公网双 PASS + 线上马群截图确认

## 断线续跑轮（模型单位制终修）2026-08-22
- [x] **根因确认：各 glb 场景单位制天差地别**（robot≈148 / horse≈303 / parrot≈168 /
      soldier≈0.0042 / xbot≈0.018）——自动 Box3 测量对 SkinnedMesh 不可靠（骨骼空间≠世界空间），
      导致 robot 蚂蚁化（"怪物不显示"）+ soldier/xbot 巨人化（被误认为正常小兵）。
      修复：ENEMY_RAW_HEIGHT 人工标定表（数值由实测 scale 反推），归一化只用常数表
- [x] 马朝向终修：剥离 root motion 后实测 -π/2 为左转 90°，正确值 = **Math.PI**
      （线上截图确认马头朝行进方向）
- [x] 回归与发布：sim 4/30 基线一致；smoke 本地+公网双 PASS；新版已上线
      （六类排排站截图确认比例统一：robot/horse/soldier/xbot/bird 均 ~1 单位）

## 实测反馈修复轮 2 2026-08-22
- [x] **蒙皮顶点实测高度**：loadEnemyTemplate 改用 SkinnedMesh.getVertexPosition 抽样
      （应用 bindMatrix+骨骼+morph+世界矩阵）测真实渲染包围盒——robot 真实高 ≈4.5 单位
      （几何 150 × 骨骼压缩 0.03），此前常数 148 全错；ENEMY_RAW_HEIGHT 仅作测量失败兜底
- [x] 敌人整体放大 1.25~1.3 倍（grunt 1.2 / horse 1.55 / tank 1.9 / flyer 0.95 /
      healer 1.3 / splitter 1.2 / Boss 2.9~3.7）——主角应比环境抢眼
- [x] 马朝向终值 Math.PI + root motion 剥离后实测确认方向正确
- [x] 已发布线上并冒烟 PASS

## 尺寸终修轮 2026-08-22
- [x] **双重世界变换 Bug**：SkinnedMesh.getVertexPosition 返回值已是世界坐标，
      之前又 applyMatrix4(matrixWorld) 造成二次缩放 → robot 系仍蚂蚁化。
      去掉多余变换后蒙皮实测口径与渲染严格一致
- [x] 动画剪辑兜底：剪辑名不匹配时取第一个剪辑（修复马无奔跑动作——Horse 剪辑名为空）
- [x] 敌人放大 1.25~1.3 倍；六类排排站截图确认比例统一（马/士兵同框协调）
- [x] 已发布线上并冒烟 PASS

## 用户反馈修复轮 3（泄漏+停射排查）2026-08-22 深夜
- [x] **高帧率卡顿真凶修复**：①漏怪尸体永久堆积（disposed 未标记→数组膨胀）②GLTF 克隆材质
      从不释放（几百只累积=显存泄漏→GC/显存交换→"帧率高但顿挫"）。双修后 3 分钟压测：
      塔开火 95 次无停射、敌人数组干净、漏怪即时回收
- [x] Tower 加 fireCount 诊断计数器（塔停射类问题可秒定位）
- [x] 线上发布 0010b24 + 公网冒烟 PASS

## 塔停射终修轮（对齐判定多圈分支 Bug）2026-08-22
- [x] **"塔打一两波后不再攻击（仍有寻敌动作）"根因定位并修复**：
      Tower.update 的开火对齐判定用 `((want-aim+3π)%2π)-π` 计算误差，而 JS `%` 对负数
      返回负余数——当塔持续同向追踪使 aim 累计整圈（want-aim=-4π 时）公式把真实误差 ~0
      算成 -2π → 永远"未对齐"→ 冷却就绪也永不开火；转向跟踪用的是正确的 while-wrap，
      把 -4π 折成 0（已对齐不用转）→ 塔静止瞄准敌人，视觉完全正常 = 用户所见症状。
      复现工具：tools/fireprobe2.mjs（逐帧统计 readyNoFire，arrow#3 第6波起 134 帧卡死、
      err 恒为 6.28）。修复：转向时记录 `_aimDiff`（与追踪同一套 wrap），开火判定改用
      `Math.abs(this._aimDiff) < 0.5`；aim 超 ±64 rad 时 mod 2π 归一化防无限增长。
      修复后 fireprobe2 同塔持续开火至游戏结束，异常帧 134→1~2。
- [x] 回归：fireprobe 多关无异常；sim 胜率 4/30→**11/30**（被卡死的塔恢复输出，
      旧基线是带 bug 测出的）；smoke.mjs PASS；dist 已重建（build-dist 原样拷贝 js/）

## 朝向终修轮（soldier/xbot 系 180° 倒退走）2026-08-23
- [x] **用户报告"第一世界最后一关怪物走路方向与身体朝向 180°"根因定位**：
      不是关卡/地图逻辑问题——Enemy 朝向公式 `atan2(-dx,-dz)+yawOff` 全关统一；
      真因是 **Soldier.glb 与 Xbot.glb 原生面向 -Z**（robot/horse/parrot 面向 +Z），
      统一配 `yaw:Math.PI` 对这两个模型恰好反转 180°。healer（soldier）d≥8 才解锁
      → 首次成批出现在世界1第9/10关且第10关前两波主力全是萨满 = 用户所见；
      splitter（xbot，d≥12）与 lava/frost Boss 同病。
- [x] 判定手段：silprobe2 头顶质心法对人形直立模型不敏感（±0.0x 不可判），
      改用**特写侧视探针**（tools/closeup.mjs / sideprobe.mjs，rotation.y=0 从 +X 侧视，
      屏幕左=+Z）逐模型目视：soldier、xbot 明确面朝 -Z（露背），robot/horse/parrot 面朝 +Z；
      bossprobe 之类"数学对齐 diff=0"探针测不出此病（旋转确实贴合切线，是模型原生朝向错）。
- [x] 修复：units.js 中 healer/splitter/lava/frost 四个 def 的 `yaw:Math.PI → 0`
      （robot/horse/parrot 系保持 π 不动）；dist 已重建同步。
- [x] 验证：tools/livecheck.mjs（真实 Enemy.update 代码路径，切线 +Z）9 类全部
      面朝行进方向（soldier/xbot 系 rotY=-π，其余 0）；?level=0,9&auto=1 实拍
      第 1 波萨满队列面向右（+X 行进方向）；smoke.mjs PASS。

## 扩展轮：第4世界「黄沙戈壁」+ 5 新怪 + 3 新地图 2026-08-23
- [x] 联网找免费模型并抓取（tools/fetch-enemies.mjs）：Fox.glb（Khronos Sample Assets，CC0）、
      CesiumMan.glb（CC-BY 4.0，Cesium，README 署名）、BrainStem.glb（CC-BY，Microsoft）；
      Quaternius 包无直链暂缓；three.js Monster.glb 各渠道全 404 弃用（Boss 沙暴法老复用 cesiumman 金色染色）
- [x] 新敌人 5 种（units.js + levelgen 难度解锁）：灵狐 fox(d≥13,速)、烈焰鸟 flamingo(d≥15,飞行)、
      干尸行者 mummy(d≥17,重甲)、苍鹳 stork(d≥19,飞行)、舞械偶 dancer(d≥21)；
      新 Boss **沙暴法老 sand**（hp5600/甲15，死亡时召唤 4 只残血干尸）
- [x] 3 张新路径地图：zigzag 之字 / deep-u 深U / vortex 漩涡（maps.js 共 6 张按 (w*3+l)%6 轮换）
- [x] 第 4 世界主题 sand 黄沙戈壁（config/terrain/decor/audio/screens/main/save 全链）：
      沙地程序化纹理（斑点+风纹）、仙人掌/遗迹/枯树装饰、专属 BGM 音阶、
      选关名与星级 90→120、存档 nextLevel w<4、主菜单/结算 w 上限 3
- [x] 模型标定：ENEMY_RAW_HEIGHT（fox 79 / cesiumman 1.64 / brainstem 1.83 / flamingo 82 / stork 70——
      鸟类 GLB 离群顶点撑大 bbox，bbox 测高不可用）+ ENEMY_DY_FIX（flamingo -66.9 / stork -286.1）修 Y 居中；
      诊断工具 tools/birdiag.mjs（bbox vs 2%~98% 百分位顶点盒）、tools/newmonprobe.mjs 逐模型特写
- [x] 修复：decor PRELOAD 漏 cactus → 仙人掌静默不显示；补上后实拍可见
- [x] 视觉验证：livecheck 扩到 15 类（11 常规+4 Boss）全部面朝行进方向
      （新怪全为 +Z 原生 yaw=π；soldier/xbot 系 yaw=0）；logs/shot-livecheck2.png；
      world4-battle.png 实拍：沙地+仙人掌+狐狸×3/烈焰鸟/干尸沿路行军、传送门/UI 正常
- [x] 回归：sim 40 关矩阵 11/40（与旧 11/30 基线同水位）；smoke PASS 5/5；dist 重建 83 文件 15.61MB
- [x] 上传 GitHub：git init + gh repo create mmuu1987/tower-defense-3d --public --source=. --push

## 管理员模式轮（用户反馈"无法调到第四世界，锁住了"）2026-08-24
- [x] 需求：用户想随意玩任意世界/关卡，星级锁挡住了第 4 世界
- [x] 实现：选关页头部新增 **🛠 管理员按钮**（开启时金色 🛠✓）→ 管理面板：
      ①🔓 解锁全部关卡（存档 admin 标志，isUnlocked 全放行，标签/卡片即时刷新）
      ②🔒 恢复正常锁定 ③4×10 任意跳转网格（无视锁定直接 enterBattle，已通关显示绿色）
      ④🗑 清空进度（confirm 防误触）⑤关闭
- [x] URL 直开：`?admin=1`（main.js 启动时 setAdmin(true)，localStorage 持久化）
- [x] 进度逻辑隔离：save.nextLevel 改用 unlockedByStars（忽略 admin）——管理员模式下
      "继续冒险"仍按真实进度推荐，不会被跳到 1-1
- [x] 验证：?admin=1 探针 4 标签全开/0 锁卡（logs/admin-select.png）；面板跳 4-5
      直接开战实拍（logs/admin-panel.png = 黄沙戈壁第5关 build 画面）；
      relock→unlock 往返数值确认；smoke PASS；线上 ?admin=1 复验通过
- [x] 部署：dist 重建 + Pages 9ec12dc + 源码仓 20e2692

## 路面净距轮（用户反馈"摆设铺在路上"）2026-08-24
- [x] 根因：decor.findSpot 只做格子级避让（isPathCell 查格心），大模型冠幅/底座压到
      相邻路径格的路面；且 path_stone 路缘石故意摆在 0.62~0.8 偏移处（正压土肩），
      俯视看就是"路上有灰石片"
- [x] 修复：decor.js 增加路径距离场（与 terrain 丝带同源的点到线段距离），
      findSpot 要求到路径中心线净距 ≥1.12（路肩半宽0.775+摆幅余量）——任何摆设不进路肩；
      移除路缘石散布与 PRELOAD 中的 path_stone；路面自带的 70 颗小碎石保留（属路面材质细节）
- [x] 验证：4 张代表图俯拍（0,0 螺旋 / 0,3 之字 / 0,5 回旋 / 3,4 沙漠深U，
      logs/clean-*.png）路面完全无摆设；smoke PASS；线上 ?level=3,4 俯拍复验
- [x] 部署：dist 重建 + Pages a00c1fa + 源码仓 1c2c0c4

## 4399 上传准备轮（用户问"放到4399需要什么流程"）2026-08-24
- [x] 调研：4399 开放平台 open.4399.cn 文档（注册/创建游戏/合规/协议/H5小游戏FAQ 全文抓取存 logs/4399-*.md）
      流程 = 注册个人开发者（实名，2工作日）→ 创建 H5 小游戏填信息 → 传 zip → 审核（1-2工作日）→
      发布到 www.4399.com + h.4399.com，平台自动挂广告 API 结算收益
- [x] **硬坑修复：4399 zip 扩展名白名单不含 .glb**（不符合的文件会被过滤）→
      49 个模型全部 git mv 改名 .dat（glTF-Binary 内容不变，GLTFLoader.parse 按 ArrayBuffer 解析无感知）；
      modellib 两处取模路径、serve MIME、fetch-enemies/pick-models 工具脚本产物名同步
- [x] 800×600 嵌入实测正常（4399 要求"尺寸控制在 800*600 以内+屏幕自适应"）；
      shot.mjs 支持 --w/--h 参数
- [x] 上传包：release/4399/tri-realm-defense-4399.zip（8.5MB，根 index.html，扩展名全白名单）；
      提交材料：release/4399/提交材料.md（游戏信息/简介/自查表/致谢/上传步骤/待办）
- [x] 回归：smoke PASS；线上 .dat 版部署 50848cd + 冒烟复验
- [ ] 待办：移动端触摸操作（4399 要求移动端+网页双端测试通过才可提审）；游戏图标

## 触摸操作 + 移动端 UI 轮（用户确认做 4399 前适配）2026-08-24
- [x] **js/engine/touch.js 新建 TouchGestures**：只接管 pointerType==='touch'，桌面行为零改动
      单指轻点（位移<12px）→ onTap → placeOrSelect（与鼠标点击同一逻辑，main.js 抽取共用）；
      单指拖动 → rig.panByPixels 平移；双指捏合 → zoomBy 缩放 + 中心移动平移 + 捻转 rotateBy 旋转；
      camera.js 抽出 panByPixels/zoomBy/rotateBy 三个手势接口（中键拖拽同源复用）；
      canvas touchAction='none'（禁浏览器滚动/双击缩放/下拉刷新）
- [x] **踩坑**：轻点判定最初带 450ms 时长上限——软渲染主线程卡顿把 down→up 拉到 649~934ms
      全被误杀；本作无长按语义，改为**纯位移阈值判定**（按住瞄准松手放置，天然抗卡顿）
- [x] HUD 移动化：新增 ⏸ 暂停按钮（原来只有 Esc）、建造模式"✕ 取消建造"芯片
      （触摸没有右键，必须有可见退出途径）、提示文案触摸版（"点空地放置 · 拖动可平移视角"）
- [x] UI 适配（css 媒体查询 ≤820px / ≤420px / 横屏 ≤460px 高）：塔坞 76→58/52px、
      HUD 紧凑、面板上移避让塔坞、横幅缩小；#fps 移左下且小屏隐藏（与资源条/塔坞重叠）；
      竖屏 (innerHeight>innerWidth) 相机 dist 17→24（enterBattle 归位处同步）；
      触屏默认"中"画质（matchMedia pointer:coarse，用户手动选过则以存档为准）；
      全局 user-select:none / tap-highlight 透明 / 按钮 touch-action:manipulation
- [x] **tools/touchprobe.mjs**：CDP Input.dispatchTouchEvent 模拟真机四连，
      数值断言（选中/建塔扣钱/平移 Δ/缩放 17→9）——ALL PASS；smoke PASS
- [x] 视觉：390×844 竖屏、844×390 横屏、800×600 嵌入三档截图正常（logs/ui-*.png）
- [x] 部署：dist 84 文件 + Pages 463d302 + 线上冒烟；源码 bae1db1
- [x] 4399 提交材料"待办"更新：触摸已完成，剩游戏图标与宣传图（可由我生成）

## 取消体验 + 新手引导轮（用户反馈"误点炮塔不知怎么取消"+"新手引导没做"）2026-08-24
- [x] **取消建造三重可见**：①右键真取消（提示文案一直承诺"右键取消"但从未实现——补上）
      ②塔坞卡片选中态显示红色"再点取消"角标 ③"✕ 取消建造"芯片加脉冲动画（所有平台显示）
- [x] **教学重做（原 3 步纯文字桩 → 5 步带高亮）**：欢迎/选塔→建塔→开波→升级→目标说明；
      目标元素呼吸光圈（.tut-glow）；最后一步"开战！"按钮；"跳过引导"常驻；
      第③步 enter 钩子自动退出建造模式（建完塔点塔升级不再撞"位置被占"）；
      设置面板新增"🔁 重看新手引导"（战斗中直接重开，否则下次进战斗触发）
- [x] **两个真 bug 修复**：
      ①exitBattle 例行调 endTutorial 把 tutorialDone 误标 true → 首次战斗教学永远不开
      （endTutorial 加 tutEl 空值守卫）
      ②教学步骤①完成条件非单调：建塔后 tryPlace→selectTower 清空 selectedType，
      步骤①重新变未完成 → 文字倒退回欢迎语（改 done: selectedType==='arrow' || towers>=1）
- [x] tools/tutprobe.mjs：全新档案模拟首次玩家全流程 10 项断言 ALL PASS
      （自动开启/高亮/取消芯片/✕取消/再选/建塔推进/自动退建造/开波推进/升级/完成存档）
- [x] 回归：smoke PASS；touchprobe ALL PASS；教学条视觉截图 logs/tutorial-step1.png
- [x] 部署：dist + Pages d7096fd + 线上冒烟；源码 e2fcfce

## 已知问题（不阻塞，可作后续打磨方向）
- 基线机器人世界1-2 仍无法通关——人类玩家有布阵/换塔/卖塔优势，难度曲线按此设计；
  若要更"手残友好"，可再降 hpMul 指数至 1.075
- Kenney 武器模型朝向按截图粗校，个别角度或需 ±15° 微调
- 敌人 GLB 材质克隆策略：每敌人全量克隆（robot ~6 材质），60+ 同屏时内存可接受，
  若未来同屏破百可改为共享材质+uniform 闪烁
- 结算后战斗画面静止（state won/lost 停更，视觉可接受）

## 后续可选方向
- Quaternius 怪物包经 itch 渠道获取（需 CSRF 脚本化，暂缓）可进一步丰富敌人种类
- 关卡内 "提前召唤下一波" 奖励金按钮；成就系统；键位/色弱设置

## 下一轮从哪里继续
（视觉升级目标已达成。恢复清单仍适用于日常开发。）
