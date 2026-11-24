// 効果音。Web Audio API で鳴らし、音声ファイルは使わない。
// iOS Safari はユーザー操作の中で AudioContext を再開する必要があるので、ボタン操作のたびに unlockAudio() を呼ぶ。

let ctx = null;
let master = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = Boolean(on);
}

function audio() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** ユーザー操作の中で呼ぶ（iOS の音声制限を解除する）。 */
export function unlockAudio() {
  audio();
}

function tone({ freq, to = null, type = "square", start = 0, dur = 0.06, gain = 0.12 }) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  /** リールが1コマ進む音 */
  tick() {
    tone({ freq: 1400, type: "square", dur: 0.025, gain: 0.05 });
  },
  /** リールが止まる音 */
  stop() {
    tone({ freq: 520, to: 260, type: "triangle", dur: 0.12, gain: 0.2 });
  },
  /** 結果が出た音 */
  reveal() {
    tone({ freq: 880, type: "triangle", dur: 0.12, gain: 0.16 });
    tone({ freq: 1320, type: "triangle", start: 0.09, dur: 0.2, gain: 0.14 });
  },
  /** 選手を選んだ音 */
  select() {
    tone({ freq: 660, type: "sine", dur: 0.05, gain: 0.12 });
  },
  /** 配置を確定した音 */
  place() {
    tone({ freq: 523.25, type: "triangle", dur: 0.14, gain: 0.16 });
    tone({ freq: 659.25, type: "triangle", start: 0.07, dur: 0.14, gain: 0.16 });
    tone({ freq: 783.99, type: "triangle", start: 0.14, dur: 0.24, gain: 0.16 });
  },
  /** パス・自動スキップの音 */
  pass() {
    tone({ freq: 440, to: 220, type: "sine", dur: 0.22, gain: 0.16 });
  },
  /** 完成のファンファーレ */
  complete() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => tone({ freq: f, type: "square", start: i * 0.11, dur: 0.16, gain: 0.08 }));
    tone({ freq: 1046.5, type: "triangle", start: 0.48, dur: 0.6, gain: 0.14 });
    tone({ freq: 1318.5, type: "triangle", start: 0.48, dur: 0.6, gain: 0.1 });
  },
  /** タイトルの「遊ぶ」 */
  start() {
    tone({ freq: 659.25, type: "triangle", dur: 0.1, gain: 0.16 });
    tone({ freq: 987.77, type: "triangle", start: 0.08, dur: 0.22, gain: 0.16 });
  },
  /** プレイボール */
  playball() {
    tone({ freq: 392, type: "square", dur: 0.12, gain: 0.08 });
    tone({ freq: 523.25, type: "square", start: 0.12, dur: 0.12, gain: 0.08 });
    tone({ freq: 659.25, type: "square", start: 0.24, dur: 0.12, gain: 0.08 });
    tone({ freq: 783.99, type: "triangle", start: 0.36, dur: 0.4, gain: 0.16 });
  },
  /** できない操作の音 */
  error() {
    tone({ freq: 180, type: "sawtooth", dur: 0.12, gain: 0.08 });
  },
};
