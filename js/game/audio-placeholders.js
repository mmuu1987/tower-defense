// G5: 技能音效占位系统
// 当前为空实现，等待音频资源准备后填充

// 在实际游戏中集成：
// import { createSkillAudio } from './game/audio-placeholders.js';
// const skillAudio = createSkillAudio();
// battle.hooks.onSkill = (tower, tier) => skillAudio.playSkill(`${tower.key}_${tier}`);

export function createSkillAudio() {
  const sounds = new Map();
  
  // 技能音效映射表
  const skillSounds = {
    arrow_signature: 'arrow-volley',
    arrow_ultimate: 'arrow-rain',
    cannon_signature: 'cannon-barrage',
    cannon_ultimate: 'cannon-carpet',
    sniper_signature: 'sniper-weakspot',
    sniper_ultimate: 'sniper-marked',
    tesla_signature: 'tesla-overload',
    tesla_ultimate: 'tesla-emp',
    frost_signature: 'frost-nova',
    frost_ultimate: 'frost-blizzard',
    venom_signature: 'venom-burst',
    venom_ultimate: 'venom-plague',
    beacon_signature: 'beacon-rally',
    beacon_ultimate: 'beacon-overdrive',
  };
  
  return {
    /**
     * 播放技能音效
     * @param {string} key - 格式："{towerKey}_{tier}"，例如 "arrow_signature"
     * @param {number} volume - 音量 0.0-1.0，默认 0.5
     */
    playSkill(key, volume = 0.5) {
      const soundId = skillSounds[key];
      if (!soundId) {
        console.warn(`[Audio] 未找到技能音效: ${key}`);
        return;
      }
      
      // TODO: 实际实现
      // const sound = sounds.get(soundId);
      // if (sound) {
      //   sound.volume = volume;
      //   sound.currentTime = 0;
      //   sound.play().catch(err => console.warn('[Audio] 播放失败:', err));
      // }
      
      // 当前仅输出日志
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[Audio] 播放技能音效: ${soundId} (音量 ${(volume * 100).toFixed(0)}%)`);
      }
    },
    
    /**
     * 预加载技能音效
     * @param {Function} onProgress - 进度回调 (loaded, total)
     * @returns {Promise<void>}
     */
    async preload(onProgress) {
      const total = Object.keys(skillSounds).length;
      let loaded = 0;
      
      for (const [key, soundId] of Object.entries(skillSounds)) {
        // TODO: 实际加载音频文件
        // const audio = new Audio(`./audio/skills/${soundId}.mp3`);
        // await audio.load();
        // sounds.set(soundId, audio);
        
        loaded++;
        onProgress?.(loaded, total);
        
        // 模拟加载延迟
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      console.log(`[Audio] 技能音效预加载完成 (${total} 个)`);
    },
    
    /**
     * 设置全局音量
     * @param {number} volume - 0.0-1.0
     */
    setVolume(volume) {
      // TODO: 更新所有音频对象的音量
      console.log(`[Audio] 设置技能音效音量: ${(volume * 100).toFixed(0)}%`);
    },
    
    /**
     * 释放所有音频资源
     */
    dispose() {
      sounds.clear();
      console.log('[Audio] 技能音效资源已释放');
    },
  };
}
