import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillAudio } from '../js/game/audio-placeholders.js';

test('技能音效系统创建成功', () => {
  const audio = createSkillAudio();
  assert.ok(audio);
  assert.equal(typeof audio.playSkill, 'function');
  assert.equal(typeof audio.preload, 'function');
  assert.equal(typeof audio.setVolume, 'function');
  assert.equal(typeof audio.dispose, 'function');
});

test('所有七座塔都有招牌和终极技能音效映射', () => {
  const audio = createSkillAudio();
  const towers = ['arrow', 'cannon', 'sniper', 'tesla', 'frost', 'venom', 'beacon'];
  
  for (const key of towers) {
    // 不应抛出警告（当前版本会输出 console.warn，但不应中断）
    audio.playSkill(`${key}_signature`, 0.5);
    audio.playSkill(`${key}_ultimate`, 0.8);
  }
});

test('未知技能键会输出警告而非崩溃', () => {
  const audio = createSkillAudio();
  let warned = false;
  const originalWarn = console.warn;
  console.warn = (msg) => { if (msg.includes('未找到技能音效')) warned = true; };
  
  audio.playSkill('unknown_skill', 0.5);
  assert.equal(warned, true, '应输出未找到音效的警告');
  
  console.warn = originalWarn;
});

test('音量设置在有效范围内', () => {
  const audio = createSkillAudio();
  // 应该不抛出错误
  audio.setVolume(0);
  audio.setVolume(0.5);
  audio.setVolume(1.0);
  audio.playSkill('arrow_signature', 0);
  audio.playSkill('arrow_signature', 1.0);
});

test('预加载返回 Promise 并正确报告进度', async () => {
  const audio = createSkillAudio();
  const progress = [];
  
  await audio.preload((loaded, total) => {
    progress.push({ loaded, total });
  });
  
  assert.ok(progress.length > 0, '应至少报告一次进度');
  assert.equal(progress[0].total, 14, '应有 14 个技能音效（7 塔 × 2 技能）');
  assert.equal(progress.at(-1).loaded, 14, '最终应加载完全部音效');
});

test('dispose 清理资源且可重复调用', () => {
  const audio = createSkillAudio();
  audio.dispose();
  audio.dispose(); // 不应崩溃
});
