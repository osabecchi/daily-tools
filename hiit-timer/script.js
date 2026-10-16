/*
 * script.js — HIITタイマーの動き
 *
 * 全体の流れ
 *   1. 設定（運動・休憩・セット数・準備）を読み込んで画面に表示
 *   2. 開始ボタンで「フェーズの一覧」（準備→運動→休憩→運動…）を作る
 *   3. 0.1秒ごとに残り時間を計算し、0になったら次のフェーズへ
 *   4. フェーズが変わる瞬間に 音・バイブ・背景色 を切り替える
 */
'use strict';

/* =========================================================
 * 1. 定数（あとから変えない値）
 * ========================================================= */

const SETTINGS_KEY = 'hiit.settings';  // localStorage に保存するときの名前

// 初めて開いたときの設定
const DEFAULT_SETTINGS = {
  work: 20,     // 運動（秒）
  rest: 10,     // 休憩（秒）
  sets: 8,      // セット数
  prep: 5,      // 準備（秒）0 なら準備なし
  sound: true,  // 音を鳴らすか
  vibrate: true // バイブするか
};

// 入力できる範囲（範囲外の値は自動で直す）
const LIMITS = {
  work: { min: 1, max: 3600 },
  rest: { min: 0, max: 3600 },
  sets: { min: 1, max: 99 },
  prep: { min: 0, max: 60 },
};

// フェーズの種類ごとの表示名
const PHASE_LABELS = {
  idle: 'スタンバイ',
  prep: '準備',
  work: '運動',
  rest: '休憩',
  done: '完了！',
};

/* =========================================================
 * 2. 画面の部品（HTML要素）を取得しておく
 * ========================================================= */

const elements = {
  phaseLabel: document.getElementById('phaseLabel'),
  time: document.getElementById('time'),
  setCount: document.getElementById('setCount'),
  progressBar: document.getElementById('progressBar'),
  nextInfo: document.getElementById('nextInfo'),
  startButton: document.getElementById('startButton'),
  resetButton: document.getElementById('resetButton'),
  wakeStatus: document.getElementById('wakeStatus'),
  fieldset: document.getElementById('settingsFieldset'),
  workInput: document.getElementById('workInput'),
  restInput: document.getElementById('restInput'),
  setsInput: document.getElementById('setsInput'),
  prepInput: document.getElementById('prepInput'),
  soundCheck: document.getElementById('soundCheck'),
  vibrateCheck: document.getElementById('vibrateCheck'),
  vibrateLabel: document.getElementById('vibrateLabel'),
  totalTime: document.getElementById('totalTime'),
};

/* =========================================================
 * 3. 状態（アプリが今どうなっているか）
 * ========================================================= */

// 保存済みの設定を読み込む。
// { ...A, ...B } は「A をベースに B で上書き」という書き方。
// 新しい設定項目を後から増やしても、古い保存データで壊れないようにしている。
let settings = { ...DEFAULT_SETTINGS, ...Storage.load(SETTINGS_KEY, {}) };

const state = {
  status: 'idle',      // 'idle'(待機) / 'running'(動作中) / 'paused'(一時停止) / 'done'(完了)
  phases: [],          // これから進むフェーズの一覧
  index: 0,            // 今が phases の何番目か
  endTime: 0,          // 今のフェーズが終わる「時刻」（ミリ秒）
  remainingMs: 0,      // 一時停止したときの残り時間（ミリ秒）
  lastBeepSecond: null,// 最後にカウント音を鳴らした秒（同じ秒で何度も鳴らさないため）
  timerId: null,       // setInterval の番号（止めるときに使う）
};

/* =========================================================
 * 4. 小さな便利関数
 * ========================================================= */

// 値を min〜max の範囲に収める
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// 秒数を表示用の文字にする（59秒までは "45"、60秒以上は "1:30"）
function formatTime(totalSeconds) {
  if (totalSeconds < 60) {
    return String(totalSeconds);
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  // padStart(2, '0')：1桁なら前に0を付けて "05" のようにする
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// 「10秒」「1:30」のように単位付きの文字にする（説明文用）
function formatDuration(totalSeconds) {
  return totalSeconds < 60 ? `${totalSeconds}秒` : formatTime(totalSeconds);
}

// 合計時間（準備 + 運動×セット + 休憩×(セット-1)）を秒で求める
function calcTotalSeconds(s) {
  return s.prep + s.work * s.sets + s.rest * (s.sets - 1);
}

/* =========================================================
 * 5. 設定フォームの読み書き
 * ========================================================= */

// settings の値を入力欄に表示する
function writeSettingsToForm() {
  elements.workInput.value = settings.work;
  elements.restInput.value = settings.rest;
  elements.setsInput.value = settings.sets;
  elements.prepInput.value = settings.prep;
  elements.soundCheck.checked = settings.sound;
  elements.vibrateCheck.checked = settings.vibrate;
}

// 入力欄の値を読み取って settings に入れる
// writeBack が true なら、範囲外だった値を直した結果を入力欄にも書き戻す
function readSettingsFromForm(writeBack) {
  const numberFields = {
    work: elements.workInput,
    rest: elements.restInput,
    sets: elements.setsInput,
    prep: elements.prepInput,
  };

  for (const key in numberFields) {
    const input = numberFields[key];
    let value = parseInt(input.value, 10);         // 文字 → 整数
    if (Number.isNaN(value)) value = settings[key]; // 空欄などは前の値のまま
    value = clamp(value, LIMITS[key].min, LIMITS[key].max);
    settings[key] = value;
    if (writeBack) input.value = value;
  }

  settings.sound = elements.soundCheck.checked;
  settings.vibrate = elements.vibrateCheck.checked;
}

// 設定が変わったときの処理
function onSettingsChange(event) {
  // 'change'（入力確定）のときだけ値を書き戻す。
  // 'input'（入力中）で書き戻すと、打っている途中の数字が勝手に直されて打ちにくいため。
  readSettingsFromForm(event.type === 'change');
  Storage.save(SETTINGS_KEY, settings);
  render();
}

/* =========================================================
 * 6. 音（Web Audio API）
 *    音声ファイルを使わず、プログラムで「ピッ」という音を作る
 * ========================================================= */

let audioContext = null;

// 音を出す準備。iPhone などは「ボタンを押した瞬間」にこれをしないと音が出ない
function unlockAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;             // 古いブラウザは音なし
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume();
}

// 1回ビープ音を鳴らす
//   frequency：音の高さ(Hz)  duration：長さ(秒)  delay：何秒後に鳴らすか
function beep(frequency, duration, delay = 0) {
  if (!settings.sound || !audioContext) return;

  const startAt = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator(); // 音の波を作る部品
  const gain = audioContext.createGain();             // 音量を調整する部品

  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  // 音量を「すっと上げて、すっと下げる」。いきなり切ると「プツッ」とノイズが出るため
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.4, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  // 波 → 音量 → スピーカー の順につなぐ
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/* =========================================================
 * 7. バイブ（対応端末のみ）
 * ========================================================= */

const canVibrate = 'vibrate' in navigator;  // バイブ機能があるか（iPhoneは無い）

function vibrate(pattern) {
  if (settings.vibrate && canVibrate) {
    navigator.vibrate(pattern);  // pattern：[振動ms, 休みms, 振動ms, ...]
  }
}

/* =========================================================
 * 8. フェーズが切り替わったときの合図（音＋バイブ）
 * ========================================================= */

function signalPhase(type) {
  if (type === 'work') {
    beep(880, 0.5);                 // 高い音で「始め！」
    vibrate([400]);
  } else if (type === 'rest') {
    beep(440, 0.25);                // 低い音2回で「休憩」
    beep(440, 0.25, 0.3);
    vibrate([150, 100, 150]);
  } else if (type === 'prep') {
    beep(660, 0.2);
  } else if (type === 'done') {
    beep(660, 0.2);                 // 3連音で「完了」
    beep(880, 0.2, 0.25);
    beep(1320, 0.5, 0.5);
    vibrate([300, 150, 300, 150, 600]);
  }
}

// 残り3・2・1秒のカウント音
function signalCountdown() {
  beep(600, 0.12);
}

/* =========================================================
 * 9. 画面を消さない（Screen Wake Lock API）
 * ========================================================= */

let wakeLock = null;
let wakeMessage = '';

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    wakeMessage = 'このブラウザは画面ONの維持に非対応です';
    render();
    return;
  }
  try {
    const lock = await navigator.wakeLock.request('screen');

    // 待っている間に一時停止・リセットされていたら、すぐ手放す
    if (state.status !== 'running') {
      lock.release();
      return;
    }

    wakeLock = lock;
    wakeMessage = '💡 タイマー中は画面を点けたままにします';
    // タブを切り替えるなどすると自動で解除されるので、そのときの後片付け
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      wakeMessage = '';
      render();
    });
  } catch (error) {
    // 電池残量が少ないとき、http:// で開いたときなどに失敗することがある
    wakeMessage = '画面ONを維持できませんでした';
  }
  render();
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();  // release イベントで wakeLock = null になる
  }
  wakeMessage = '';
}

// タブに戻ってきたとき、タイマー動作中なら画面ONをもう一度お願いする
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.status === 'running' && !wakeLock) {
    requestWakeLock();
  }
});

/* =========================================================
 * 10. タイマー本体
 * ========================================================= */

// 設定から「フェーズの一覧」を作る
// 例）準備5・運動20・休憩10・2セット → [準備5, 運動20(1), 休憩10(1), 運動20(2)]
function buildPhases(s) {
  const phases = [];
  if (s.prep > 0) {
    phases.push({ type: 'prep', duration: s.prep, set: 0 });
  }
  for (let set = 1; set <= s.sets; set++) {
    phases.push({ type: 'work', duration: s.work, set });
    // 最後のセットの後は休憩しない。休憩0秒のときも入れない
    if (set < s.sets && s.rest > 0) {
      phases.push({ type: 'rest', duration: s.rest, set });
    }
  }
  return phases;
}

// index 番目のフェーズに入る。startTime はそのフェーズが始まった時刻
function enterPhase(index, startTime) {
  const phase = state.phases[index];
  state.index = index;
  state.endTime = startTime + phase.duration * 1000;
  // 開始直後の秒ではカウント音を鳴らさない（切り替え音と重なるため）
  state.lastBeepSecond = phase.duration;
  signalPhase(phase.type);
}

// 開始（または再開）
function start() {
  unlockAudio();                     // ボタンを押したこの瞬間に音の準備をする
  readSettingsFromForm(true);

  if (state.status === 'paused') {
    // 再開：残っていた時間から終了時刻を計算し直す
    state.endTime = Date.now() + state.remainingMs;
  } else {
    // 最初から：フェーズ一覧を作って 0 番目から始める
    state.phases = buildPhases(settings);
    enterPhase(0, Date.now());
  }

  state.status = 'running';
  // 0.1秒ごとに tick を呼ぶ（1秒ごとだと表示の切り替わりが遅れて見えるため）
  state.timerId = setInterval(tick, 100);
  requestWakeLock();
  render();
}

// 一時停止
function pause() {
  state.remainingMs = state.endTime - Date.now();
  state.status = 'paused';
  clearInterval(state.timerId);
  releaseWakeLock();
  render();
}

// リセット
function reset() {
  clearInterval(state.timerId);
  state.status = 'idle';
  state.phases = [];
  state.index = 0;
  releaseWakeLock();
  render();
}

// 全フェーズ終了
function finish() {
  clearInterval(state.timerId);
  state.status = 'done';
  signalPhase('done');
  releaseWakeLock();
  render();
}

// 0.1秒ごとに呼ばれる処理
function tick() {
  const now = Date.now();

  // 【ポイント】「回数を数える」のではなく「終了時刻との差」で判断する。
  // スマホで別アプリを開くと setInterval は遅れたり止まったりするが、
  // 時刻で計算していれば戻ってきたときに正しい位置へ追いつける。
  // 何フェーズも過ぎていることがあるので if ではなく while で進める。
  let changed = false;
  while (now >= state.endTime) {
    if (state.index >= state.phases.length - 1) {
      finish();
      return;
    }
    state.index++;
    // 前のフェーズの終了時刻を次の開始時刻にする（ズレが積み重ならない）
    state.endTime += state.phases[state.index].duration * 1000;
    changed = true;
  }

  if (changed) {
    // 追いついた最後のフェーズの合図だけ鳴らす（音が連打されないように）
    const phase = state.phases[state.index];
    state.lastBeepSecond = phase.duration;
    signalPhase(phase.type);
  }

  // 残り3・2・1秒でカウント音
  const secondsLeft = Math.ceil((state.endTime - now) / 1000);
  if (secondsLeft <= 3 && secondsLeft >= 1 && secondsLeft !== state.lastBeepSecond) {
    state.lastBeepSecond = secondsLeft;
    signalCountdown();
  }

  render();
}

// 開始ボタン：状態に応じて「開始」「一時停止」を切り替える
function toggleStartPause() {
  if (state.status === 'running') {
    pause();
  } else {
    start();
  }
}

/* =========================================================
 * 11. 画面の表示を今の状態に合わせる
 *     （状態を変えたら必ず render() を呼ぶ、というルールにしている）
 * ========================================================= */

function render() {
  const { status } = state;
  let phaseType, secondsLeft, progress, setText, nextText;

  if (status === 'idle') {
    // 待機中：最初のフェーズの秒数を表示しておく
    phaseType = 'idle';
    secondsLeft = settings.prep > 0 ? settings.prep : settings.work;
    progress = 0;
    setText = `全 ${settings.sets} セット`;
    nextText = settings.prep > 0 ? `準備 ${formatDuration(settings.prep)} → 運動スタート` : '開始するとすぐ運動スタート';
  } else if (status === 'done') {
    phaseType = 'done';
    secondsLeft = 0;
    progress = 1;
    setText = `${settings.sets} / ${settings.sets} セット`;
    nextText = 'お疲れさまでした！';
  } else {
    // 動作中・一時停止中
    const phase = state.phases[state.index];
    const remainingMs = status === 'paused' ? state.remainingMs : state.endTime - Date.now();
    phaseType = phase.type;
    secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
    progress = 1 - remainingMs / (phase.duration * 1000);
    setText = phase.type === 'prep' ? `全 ${settings.sets} セット` : `${phase.set} / ${settings.sets} セット`;

    const next = state.phases[state.index + 1];
    nextText = next ? `次：${PHASE_LABELS[next.type]} ${formatDuration(next.duration)}` : 'ラスト！';
  }

  // --- 文字の表示 ---
  let label = PHASE_LABELS[phaseType];
  if (status === 'paused') label += '（一時停止中）';
  elements.phaseLabel.textContent = label;
  elements.time.textContent = formatTime(secondsLeft);
  elements.setCount.textContent = setText;
  elements.nextInfo.textContent = nextText;
  elements.progressBar.style.width = `${clamp(progress, 0, 1) * 100}%`;

  // --- 背景色：body の class を付け替える ---
  document.body.className = `phase-${phaseType}`;
  document.body.classList.toggle('is-paused', status === 'paused');

  // --- ボタンの文字 ---
  const buttonTexts = { idle: '開始', running: '一時停止', paused: '再開', done: 'もう一度' };
  elements.startButton.textContent = buttonTexts[status];

  // --- タイマー中は設定をロック ---
  elements.fieldset.disabled = status === 'running' || status === 'paused';

  // --- その他 ---
  elements.totalTime.textContent = formatDuration(calcTotalSeconds(settings));
  elements.wakeStatus.textContent = status === 'running' ? wakeMessage : '';
  // タブのタイトルにも残り時間を出す（PCで別タブを見ていても分かる）
  document.title = status === 'running' || status === 'paused'
    ? `${formatTime(secondsLeft)} ${PHASE_LABELS[phaseType]} | HIITタイマー`
    : 'HIITタイマー | 毎日ツール集';
}

/* =========================================================
 * 12. 初期化（ページを開いたときに1回だけ行う）
 * ========================================================= */

function init() {
  writeSettingsToForm();

  // バイブ非対応の端末ではチェックボックスを押せなくする
  if (!canVibrate) {
    elements.vibrateCheck.disabled = true;
    elements.vibrateLabel.textContent = 'バイブ（この端末は非対応）';
  }

  // 設定の入力欄：'input' は入力のたび、'change' は確定したとき
  elements.fieldset.addEventListener('input', onSettingsChange);
  elements.fieldset.addEventListener('change', onSettingsChange);

  // ボタン
  elements.startButton.addEventListener('click', toggleStartPause);
  elements.resetButton.addEventListener('click', reset);

  // PC用：スペースキーで開始／一時停止（入力欄に入力中のときは除く）
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON') return;  // ボタン上のスペースはブラウザ標準の「押す」に任せる
    event.preventDefault();  // ページがスクロールするのを止める
    toggleStartPause();
  });

  render();
}

init();
