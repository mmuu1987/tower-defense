import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_DEFS, specializationFor } from '../js/game/skills.js';

test('所有七座塔都有 A/B 专精定义', () => {
  const towers = ['arrow', 'cannon', 'sniper', 'tesla', 'frost', 'venom', 'beacon'];
  for (const key of towers) {
    const specA = specializationFor(key, 'A');
    const specB = specializationFor(key, 'B');
    assert.ok(specA, `${key} 应有专精 A`);
    assert.ok(specB, `${key} 应有专精 B`);
    assert.ok(specA.key, `${key} 专精 A 应有 key`);
    assert.ok(specA.name, `${key} 专精 A 应有 name`);
    assert.ok(specA.desc, `${key} 专精 A 应有 desc`);
    assert.ok(specA.modifiers, `${key} 专精 A 应有 modifiers`);
    assert.ok(typeof specA.modifiers === 'object', `${key} 专精 A modifiers 应是对象`);
    assert.ok(Object.keys(specA.modifiers).length > 0, `${key} 专精 A 应至少有一个修改器`);
  }
});

test('专精修改器类型验证', () => {
  const towers = ['arrow', 'cannon', 'sniper', 'tesla', 'frost', 'venom', 'beacon'];
  for (const key of towers) {
    for (const branch of ['A', 'B']) {
      const spec = specializationFor(key, branch);
      for (const [modKey, modValue] of Object.entries(spec.modifiers)) {
        // 百分比修改器
        if (modKey.endsWith('Pct')) {
          assert.ok(typeof modValue === 'number', `${key} ${branch} ${modKey} 应是数字`);
          assert.ok(Math.abs(modValue) < 5, `${key} ${branch} ${modKey} 应在合理范围内（-500%~500%）`);
        }
        // 绝对值修改器
        if (['armorPenetration', 'chains', 'signatureRadius', 'signatureDuration', 'poisonMaxStacks'].includes(modKey)) {
          assert.ok(typeof modValue === 'number', `${key} ${branch} ${modKey} 应是数字`);
        }
        // 布尔修改器
        if (modKey === 'trueDamage') {
          assert.ok(typeof modValue === 'boolean', `${key} ${branch} ${modKey} 应是布尔值`);
        }
        // 对象修改器（如 slow）
        if (modKey === 'slow') {
          assert.ok(typeof modValue === 'object', `${key} ${branch} ${modKey} 应是对象`);
          assert.ok(typeof modValue.pct === 'number', `${key} ${branch} slow.pct 应是数字`);
          assert.ok(typeof modValue.dur === 'number', `${key} ${branch} slow.dur 应是数字`);
        }
      }
    }
  }
});

test('专精描述文本非空', () => {
  const towers = ['arrow', 'cannon', 'sniper', 'tesla', 'frost', 'venom', 'beacon'];
  for (const key of towers) {
    for (const branch of ['A', 'B']) {
      const spec = specializationFor(key, branch);
      assert.ok(spec.desc.length > 0, `${key} ${branch} 描述不应为空`);
      assert.ok(spec.desc.length <= 50, `${key} ${branch} 描述不应过长（${spec.desc.length} 字符）`);
    }
  }
});

test('每座塔的 A/B 专精有明显差异', () => {
  const towers = ['arrow', 'cannon', 'sniper', 'tesla', 'frost', 'venom', 'beacon'];
  for (const key of towers) {
    const specA = specializationFor(key, 'A');
    const specB = specializationFor(key, 'B');
    
    // 修改器键名不应完全相同
    const keysA = Object.keys(specA.modifiers).sort();
    const keysB = Object.keys(specB.modifiers).sort();
    const identical = JSON.stringify(keysA) === JSON.stringify(keysB);
    
    if (identical) {
      // 如果修改器键名相同，数值应有差异
      for (const k of keysA) {
        const diff = Math.abs(specA.modifiers[k] - specB.modifiers[k]);
        assert.ok(diff > 0.01, `${key} A/B 专精的 ${k} 应有明显差异`);
      }
    }
    // 否则修改器键名不同本身就是差异
  }
});
