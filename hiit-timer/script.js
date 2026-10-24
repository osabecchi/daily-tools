/*
 * script.js — HIITタイマーの動き
 *
 * 全体の流れ
 *   1. 設定（運動・休憩・セット数・準備）と種目の一覧を読み込んで画面に表示
 *   2. 開始ボタンで「フェーズの一覧」（準備→運動→休憩→運動…）を作る
 *      このとき、全フェーズの合図音を1本の音声ファイルにまとめて作っておく
 *   3. 0.1秒ごとに残り時間を計算し、0になったら次のフェーズへ
 *   4. フェーズが変わる瞬間に 音・バイブ・背景色・種目名 を切り替える
 *
 * 画面ロック中も音を鳴らす仕組み
 *   JavaScript のタイマーは、画面が消えると止められてしまう。
 *   でも「音楽の再生」はロック中も続くので、
 *   合図音をあらかじめ1本の音声ファイル（無音の中に「ピッ」が入ったもの）に作っておき、
 *   <audio> で再生する。音の鳴るタイミングは音声ファイルの中に入っているので、
 *   JavaScript が止まっていても、ちゃんとその時間に鳴る。
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
  vibrate: true,// バイブするか
  exercises: [] // 種目の一覧 [{ id, name }]。セットごとに順番に使う
};

// 入力できる範囲（範囲外の値は自動で直す）
const LIMITS = {
  work: { min: 1, max: 3600 },
  rest: { min: 0, max: 3600 },
  sets: { min: 1, max: 99 },
  prep: { min: 0, max: 60 },
};

// 種目の上限
const EXERCISE_NAME_MAX = 20;   // 1つの名前の長さ
const EXERCISE_MAX_COUNT = 30;  // 登録できる数

// フェーズの種類ごとの表示名
const PHASE_LABELS = {
  idle: 'スタンバイ',
  prep: '準備',
  work: '運動',
  rest: '休憩',
  done: '完了！',
};

// フェーズが始まるときに鳴らす音。{ frequency: 音の高さ(Hz), duration: 長さ(秒), delay: 何秒後に鳴らすか }
// 画面を開いているときの音（beep）と、音声ファイルを作るとき（buildTrack）の両方でこの表を使う。
// 音を変えたくなったら、ここだけ直せば両方に反映される。
const PHASE_TONES = {
  prep: [{ frequency: 660, duration: 0.2, delay: 0 }],
  work: [{ frequency: 880, duration: 0.5, delay: 0 }],                         // 高い音で「始め！」
  rest: [{ frequency: 440, duration: 0.25, delay: 0 },                         // 低い音2回で「休憩」
         { frequency: 440, duration: 0.25, delay: 0.3 }],
  done: [{ frequency: 660, duration: 0.2, delay: 0 },                          // 3連音で「完了」
         { frequency: 880, duration: 0.2, delay: 0.25 },
         { frequency: 1320, duration: 0.5, delay: 0.5 }],
};

// フェーズが始まるときのバイブのパターン [振動ms, 休みms, 振動ms, ...]
const PHASE_VIBRATIONS = {
  work: [400],
  rest: [150, 100, 150],
  done: [300, 150, 300, 150, 600],
};

// 残り3・2・1秒のカウント音
const COUNTDOWN_TONE = { frequency: 600, duration: 0.12 };

// 音声ファイル（背景再生用）の設定
const TRACK_RATE = 8000;          // 1秒を何個の数値で表すか。小さいほどファイルが軽い（ピッ音には十分）
const TRACK_MAX_SECONDS = 3600;   // 作れる長さの上限（60分）。これより長いと重くなりすぎる
const TRACK_TAIL_SECONDS = 1.5;   // 最後の「完了」の音を鳴らし切るための余白
const TRACK_VOLUME = 0.8;         // 音の大きさ（0〜1）
const WAV_HEADER_BYTES = 44;      // WAV ファイルの先頭の「説明部分」の大きさ

/* =========================================================
 * 2. 画面の部品（HTML要素）を取得しておく
 * ========================================================= */

const elements = {
  phaseLabel: document.getElementById('phaseLabel'),
  exerciseName: document.getElementById('exerciseName'),
  time: document.getElementById('time'),
  setCount: document.getElementById('setCount'),
  progressBar: document.getElementById('progressBar'),
  nextInfo: document.getElementById('nextInfo'),
  startButton: document.getElementById('startButton'),
  resetButton: document.getElementById('resetButton'),
  wakeStatus: document.getElementById('wakeStatus'),
  exerciseFieldset: document.getElementById('exerciseFieldset'),
  exerciseList: document.getElementById('exerciseList'),
  exerciseAddForm: document.getElementById('exerciseAddForm'),
  exerciseNameInput: document.getElementById('exerciseNameInput'),
  exerciseAddButton: document.getElementById('exerciseAddButton'),
  exerciseHint: document.getElementById('exerciseHint'),
  fieldset: document.getElementById('settingsFieldset'),
  workInput: document.getElementById('workInput'),
  restInput: document.getElementById('restInput'),
  setsInput: document.getElementById('setsInput'),
  prepInput: document.getElementById('prepInput'),
  soundCheck: document.getElementById('soundCheck'),
  vibrateCheck: document.getElementById('vibrateCheck'),
  vibrateLabel: document.getElementById('vibrateLabel'),
  totalTime: document.getElementById('totalTime'),
  soundNote: document.getElementById('soundNote'),
};

/* =========================================================
 * 3. 状態（アプリが今どうなっているか）
 * ========================================================= */

// 保存済みの設定を読み込む。
// { ...A, ...B } は「A をベースに B で上書き」という書き方。
// 新しい設定項目を後から増やしても、古い保存データで壊れないようにしている。
let settings = { ...DEFAULT_SETTINGS, ...Storage.load(SETTINGS_KEY, {}) };
// 種目は形が正しいか確認しながら、新しい配列として作り直す。
// （DEFAULT_SETTINGS の [] をそのまま使うと、種目を追加したときに初期値まで変わってしまうため）
settings.exercises = sanitizeExercises(settings.exercises);

const state = {
  status: 'idle',      // 'idle'(待機) / 'running'(動作中) / 'paused'(一時停止) / 'done'(完了)
  phases: [],          // これから進むフェーズの一覧
  index: 0,            // 今が phases の何番目か
  endTime: 0,          // 今のフェーズが終わる「時刻」（ミリ秒）
  remainingMs: 0,      // 一時停止したときの残り時間（ミリ秒）
  lastBeepSecond: null,// 最後にカウント音を鳴らした秒（同じ秒で何度も鳴らさないため）
  timerId: null,       // setInterval の番号（止めるときに使う）
  trackOffsets: [],    // 各フェーズが「音声ファイルの何秒目」から始まるか
};

/* =========================================================
 * 4. 小さな便利関数
 * ========================================================= */

// 値を min〜max の範囲に収める
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// 種目を見分けるための ID を作る（時刻 + ランダムな文字）
function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

function saveSettings() {
  Storage.save(SETTINGS_KEY, settings);
}

// 設定が変わったときの処理
function onSettingsChange(event) {
  // 'change'（入力確定）のときだけ値を書き戻す。
  // 'input'（入力中）で書き戻すと、打っている途中の数字が勝手に直されて打ちにくいため。
  readSettingsFromForm(event.type === 'change');
  saveSettings();
  render();
}

/* =========================================================
 * 5-2. 種目（追加・編集・削除・並び替え）
 *      種目は settings.exercises に [{ id, name }, ...] の形で持つ。
 *      運動のセットごとに順番に使い、最後まで行ったら最初に戻る。
 *      （例）種目が A・B・C でセット数 8 → A B C A B C A B
 * ========================================================= */

// 保存データから種目の一覧を作る。形が変なものは取り除く
function sanitizeExercises(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item.name === 'string')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : createId(),
      name: item.name.trim().slice(0, EXERCISE_NAME_MAX),
    }))
    .filter((item) => item.name !== '')
    .slice(0, EXERCISE_MAX_COUNT);
}

// set 番目（1から数える）のセットで行う種目の名前。種目が未登録なら空の文字
function exerciseForSet(s, set) {
  const list = s.exercises;
  // % は割り算の余り。種目の数でぐるぐる回る（3種目なら 1,2,3,1,2,3…）
  return list.length > 0 ? list[(set - 1) % list.length].name : '';
}

function findExerciseIndex(id) {
  return settings.exercises.findIndex((exercise) => exercise.id === id);
}

function onExerciseAdd(event) {
  event.preventDefault();  // フォーム送信でページが再読み込みされるのを止める
  const name = elements.exerciseNameInput.value.trim();
  if (!name || settings.exercises.length >= EXERCISE_MAX_COUNT) return;

  settings.exercises.push({ id: createId(), name });
  saveSettings();
  elements.exerciseNameInput.value = '';
  renderExerciseList();
  render();
  elements.exerciseNameInput.focus();  // 続けて追加できるように入力欄に戻る
}

// 一覧の中のボタン（上へ／下へ／削除）。
// 一覧は作り直されるので、ボタン1つ1つではなく親の <ol> でまとめてクリックを受け取る（イベント委任）
function onExerciseListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const index = findExerciseIndex(id);
  if (index === -1) return;

  if (action === 'delete') {
    if (!confirm(`「${settings.exercises[index].name}」を削除しますか？`)) return;
    settings.exercises.splice(index, 1);  // splice(位置, 個数)：配列から取り除く
  } else {
    // 隣と入れ替える。[a, b] = [b, a] は「aとbの中身を交換する」書き方
    const target = action === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= settings.exercises.length) return;
    const list = settings.exercises;
    [list[index], list[target]] = [list[target], list[index]];
  }

  saveSettings();
  renderExerciseList();
  render();

  // 並び替えのあとも、同じボタンをすぐ押せるようにフォーカスを戻す
  if (action !== 'delete') {
    const sameButton = elements.exerciseList.querySelector(
      `button[data-id="${id}"][data-action="${action}"]`
    );
    if (sameButton && !sameButton.disabled) sameButton.focus();
  }
}

// 名前の編集（'change' は入力が確定したときに起きる）
function onExerciseListChange(event) {
  const input = event.target;
  if (input.type !== 'text') return;

  const index = findExerciseIndex(input.dataset.id);
  if (index === -1) return;

  const name = input.value.trim().slice(0, EXERCISE_NAME_MAX);
  if (!name) {
    // 空欄にされたら元の名前に戻す（種目の削除は「削除」ボタンで行う）
    input.value = settings.exercises[index].name;
    return;
  }
  settings.exercises[index].name = name;
  input.value = name;
  saveSettings();
  // ここで一覧を作り直すと、ほかのボタンを押そうとした操作が空振りするので、タイマー表示だけ更新する
  render();
}

/* =========================================================
 * 6. 音（Web Audio API）
 *    音声ファイルを使わず、プログラムで「ピッ」という音を作る。
 *    これは「画面を開いているとき」の音。画面ロック中は 6-2 の音声ファイルが鳴らす。
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
 * 6-2. 背景再生用の音声ファイル
 *      タイマーを開始するとき、全フェーズの合図音を入れた音声（WAV）を作って <audio> で再生する。
 *      <audio> の再生は画面ロック中も続くので、ロック中でも音が鳴る。
 *      （ロック中は JavaScript が止まっても、音声ファイルの中の「ピッ」は決まった時間に鳴る）
 * ========================================================= */

const trackAudio = new Audio();   // 音声を再生する部品（画面には出ない）
trackAudio.preload = 'auto';

let trackUrl = null;       // 作った音声ファイルの置き場所（blob: で始まる一時的なURL）
let trackActive = false;   // 今回の実行で「音声ファイルの音」を使うか（true のとき beep は鳴らさない）
let soundMessage = '';     // 音について画面に出すお知らせ

// 音声ファイルを作る。戻り値：{ blob: 音声ファイル, offsets: 各フェーズが始まる秒数 }
function buildTrack(phases) {
  // --- 1. 各フェーズが音声の「何秒目」から始まるかを求める ---
  const offsets = [];
  let totalSeconds = 0;
  phases.forEach((phase) => {
    offsets.push(totalSeconds);
    totalSeconds += phase.duration;
  });

  // --- 2. 鳴らす音を「何秒目に・どの高さで・何秒間」の一覧にする ---
  const tones = [];
  phases.forEach((phase, i) => {
    // フェーズが始まる合図
    PHASE_TONES[phase.type].forEach((tone) => {
      tones.push({ at: offsets[i] + tone.delay, frequency: tone.frequency, duration: tone.duration });
    });
    // 残り3・2・1秒のカウント音。
    // フェーズが短いときは、始まりの合図と重ならないように「秒数 < フェーズの長さ」のものだけ鳴らす
    for (let secondsLeft = 3; secondsLeft >= 1; secondsLeft--) {
      if (secondsLeft < phase.duration) {
        tones.push({
          at: offsets[i] + phase.duration - secondsLeft,
          frequency: COUNTDOWN_TONE.frequency,
          duration: COUNTDOWN_TONE.duration,
        });
      }
    }
  });
  // 最後の「完了」の音
  PHASE_TONES.done.forEach((tone) => {
    tones.push({ at: totalSeconds + tone.delay, frequency: tone.frequency, duration: tone.duration });
  });

  // --- 3. 無音の音声データを用意して、音を書き込む ---
  // 8bit の音声は「0〜255 の数字が並んだもの」。128 がちょうど無音
  const sampleCount = Math.ceil((totalSeconds + TRACK_TAIL_SECONDS) * TRACK_RATE);
  const bytes = new Uint8Array(WAV_HEADER_BYTES + sampleCount);
  bytes.fill(128, WAV_HEADER_BYTES);
  tones.forEach((tone) => writeTone(bytes, tone));

  // --- 4. 先頭に WAV ファイルの「説明部分」を書く ---
  writeWavHeader(bytes, sampleCount);

  return { blob: new Blob([bytes], { type: 'audio/wav' }), offsets };
}

// 音声データに、サイン波の「ピッ」を1つ書き込む（重なった部分は足し合わせる）
function writeTone(bytes, tone) {
  const startIndex = WAV_HEADER_BYTES + Math.round(tone.at * TRACK_RATE);
  const count = Math.round(tone.duration * TRACK_RATE);

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    if (index >= bytes.length) break;

    const t = i / TRACK_RATE;  // この数値が鳴る時刻（音の頭から何秒後か）
    // beep() と同じ考え方：0.01秒ですっと立ち上げて、あとはなめらかに小さくする（プツッというノイズ防止）
    const envelope = t < 0.01 ? t / 0.01 : Math.pow(0.0001, (t - 0.01) / (tone.duration - 0.01));
    const wave = Math.sin(2 * Math.PI * tone.frequency * t) * envelope * TRACK_VOLUME;

    bytes[index] = clamp(Math.round(bytes[index] + wave * 127), 0, 255);
  }
}

// WAV ファイルの先頭 44 バイト（「これは 8000Hz・8bit・モノラルの音声です」という説明）を書く
function writeWavHeader(bytes, dataLength) {
  const view = new DataView(bytes.buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);   // true：下の桁から順に並べる（WAV の決まり）
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);               // この説明部分の大きさ
  view.setUint16(20, 1, true);                // 1 = 圧縮なし（PCM）
  view.setUint16(22, 1, true);                // チャンネル数 1（モノラル）
  view.setUint32(24, TRACK_RATE, true);       // 1秒あたりの数値の数
  view.setUint32(28, TRACK_RATE, true);       // 1秒あたりのバイト数（8bit・モノラルなので同じ）
  view.setUint16(32, 1, true);                // 1回分のバイト数
  view.setUint16(34, 8, true);                // 1つの数値の大きさ（8bit）
  writeText(36, 'data');
  view.setUint32(40, dataLength, true);       // 音のデータの大きさ
}

// 開始のとき：音声ファイルを作って、再生の準備をする（音が OFF・長すぎるときは何もしない）
function prepareTrack() {
  releaseTrack();
  if (!settings.sound) return;

  const totalSeconds = calcTotalSeconds(settings);
  if (totalSeconds > TRACK_MAX_SECONDS) {
    soundMessage = '合計時間が長いため、画面ロック中は音が鳴りません';
    return;
  }

  const { blob, offsets } = buildTrack(state.phases);
  trackUrl = URL.createObjectURL(blob);  // ファイルを <audio> に渡せる一時的なURLにする
  trackAudio.src = trackUrl;
  state.trackOffsets = offsets;
  trackActive = true;
  soundMessage = '🔊 画面ロック中も鳴るよう、音声で再生しています';
}

// 再生する。fromSeconds：音声の何秒目から（一時停止からの再開で使う）
function playTrack(fromSeconds) {
  if (fromSeconds > 0) {
    try {
      trackAudio.currentTime = fromSeconds;
    } catch (error) {
      // 読み込み前などで位置を指定できなくても、アプリは止めない
    }
  }

  const promise = trackAudio.play();
  if (promise && promise.catch) {
    promise.catch((error) => {
      // AbortError は「再生しようとした直後に停止・リセットされた」だけなので無視する
      if (error.name === 'AbortError' || !trackActive || state.status === 'idle') return;
      // 自動再生をブロックされたなど：画面を開いている間だけ鳴る、いつもの音に切り替える
      trackActive = false;
      soundMessage = '音声を再生できなかったため、画面ロック中は音が鳴りません';
      if (state.status === 'running') playPhaseSound(state.phases[state.index].type);
      render();
    });
  }
}

// 音声の再生を止めて、作ったファイルを片付ける
function releaseTrack() {
  trackActive = false;
  soundMessage = '';
  trackAudio.pause();
  if (trackUrl) {
    trackAudio.removeAttribute('src');
    trackAudio.load();            // 読み込み済みの音声を手放す
    URL.revokeObjectURL(trackUrl); // 一時的なURLを使い終わったと知らせて、メモリを空ける
    trackUrl = null;
  }
  state.trackOffsets = [];
}

// 「今、音声ファイルの何秒目にいるはずか」。remainingMs：今のフェーズの残り時間(ミリ秒)
function currentTrackSeconds(remainingMs) {
  const phase = state.phases[state.index];
  return state.trackOffsets[state.index] + (phase.duration * 1000 - remainingMs) / 1000;
}

// 画面に戻ってきたとき、音声の位置がズレていたり止まっていたりしたら直す
function syncTrack() {
  if (!trackActive || state.status !== 'running') return;

  const expected = currentTrackSeconds(state.endTime - Date.now());
  if (Math.abs(trackAudio.currentTime - expected) > 0.5 && expected < trackAudio.duration) {
    trackAudio.currentTime = expected;
  }
  if (trackAudio.paused && !trackAudio.ended) {
    trackAudio.play().catch(() => {});
  }
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

// 画面を開いているとき用の音（PHASE_TONES の表どおりに鳴らす）
function playPhaseSound(type) {
  PHASE_TONES[type].forEach((tone) => beep(tone.frequency, tone.duration, tone.delay));
}

function signalPhase(type) {
  // 音声ファイルで鳴らしているときは、ここで鳴らすと二重になるので鳴らさない
  if (!trackActive) playPhaseSound(type);
  if (PHASE_VIBRATIONS[type]) vibrate(PHASE_VIBRATIONS[type]);
}

// 残り3・2・1秒のカウント音
function signalCountdown() {
  beep(COUNTDOWN_TONE.frequency, COUNTDOWN_TONE.duration);
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

// タブに戻ってきたとき、タイマー動作中なら画面ONをもう一度お願いして、音声の位置も確認する
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.status === 'running') {
    if (!wakeLock) requestWakeLock();
    syncTrack();
  }
});

/* =========================================================
 * 9-2. ロック画面の操作（Media Session API）
 *      音声を再生していると、ロック画面や通知に「再生／一時停止」ボタンが出る。
 *      そのボタンとタイマーをつなぐ。
 * ========================================================= */

let lastMediaTitle = '';

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('play', () => {
      if (state.status === 'paused') start();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (state.status === 'running') pause();
    });
  } catch (error) {
    // 対応していない操作があっても、アプリは止めない
  }
}

// ロック画面に出す題名を更新する（変わったときだけ）
function updateMediaSession(title, subtitle) {
  if (!('mediaSession' in navigator)) return;
  try {
    const key = `${title}|${subtitle}`;
    if (key !== lastMediaTitle) {
      lastMediaTitle = key;
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: subtitle });
    }
    navigator.mediaSession.playbackState =
      state.status === 'running' ? 'playing' : state.status === 'paused' ? 'paused' : 'none';
  } catch (error) {
    // 対応していなくても、アプリは止めない
  }
}

/* =========================================================
 * 10. タイマー本体
 * ========================================================= */

// 設定から「フェーズの一覧」を作る
// 例）準備5・運動20・休憩10・2セット → [準備5, 運動20(1), 休憩10(1), 運動20(2)]
// exercise：運動なら「そのセットの種目」、休憩・準備なら「次にやる種目」
function buildPhases(s) {
  const phases = [];
  if (s.prep > 0) {
    phases.push({ type: 'prep', duration: s.prep, set: 0, exercise: exerciseForSet(s, 1) });
  }
  for (let set = 1; set <= s.sets; set++) {
    phases.push({ type: 'work', duration: s.work, set, exercise: exerciseForSet(s, set) });
    // 最後のセットの後は休憩しない。休憩0秒のときも入れない
    if (set < s.sets && s.rest > 0) {
      phases.push({ type: 'rest', duration: s.rest, set, exercise: exerciseForSet(s, set + 1) });
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
    // 音声も、止めた位置から再開する
    if (trackActive) playTrack(currentTrackSeconds(state.remainingMs));
  } else {
    // 最初から：フェーズ一覧と音声ファイルを作って 0 番目から始める
    state.phases = buildPhases(settings);
    prepareTrack();
    enterPhase(0, Date.now());
    if (trackActive) playTrack(0);
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
  if (trackActive) trackAudio.pause();
  releaseWakeLock();
  render();
}

// リセット
function reset() {
  clearInterval(state.timerId);
  state.status = 'idle';
  state.phases = [];
  state.index = 0;
  releaseTrack();
  releaseWakeLock();
  render();
}

// 全フェーズ終了
function finish() {
  clearInterval(state.timerId);
  state.status = 'done';
  signalPhase('done');
  // 音声は止めない：最後の「完了」の音を最後まで鳴らし切るため（片付けは次の開始かリセットで行う）
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

  // 残り3・2・1秒でカウント音（音声ファイルで鳴らしているときは、音声に入っているので鳴らさない）
  const secondsLeft = Math.ceil((state.endTime - now) / 1000);
  if (secondsLeft <= 3 && secondsLeft >= 1 && secondsLeft !== state.lastBeepSecond) {
    state.lastBeepSecond = secondsLeft;
    if (!trackActive) signalCountdown();
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

// 種目の一覧を作り直す
function renderExerciseList() {
  const list = settings.exercises;

  if (list.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'exercise-empty';
    empty.textContent = '種目はまだありません。下の欄から追加してください';
    elements.exerciseList.replaceChildren(empty);
  } else {
    const items = list.map((exercise, index) => {
      const item = document.createElement('li');
      item.className = 'exercise-item';

      const number = document.createElement('span');
      number.className = 'exercise-no';
      number.textContent = String(index + 1);

      const input = document.createElement('input');
      input.type = 'text';
      input.value = exercise.name;
      input.maxLength = EXERCISE_NAME_MAX;
      input.dataset.id = exercise.id;
      input.setAttribute('aria-label', `${index + 1}番目の種目名`);

      const up = createExerciseButton('up', '↑', exercise, `${exercise.name} を上へ`);
      up.disabled = index === 0;
      const down = createExerciseButton('down', '↓', exercise, `${exercise.name} を下へ`);
      down.disabled = index === list.length - 1;
      const remove = createExerciseButton('delete', '削除', exercise, `${exercise.name} を削除`);

      item.append(number, input, up, down, remove);
      return item;
    });
    elements.exerciseList.replaceChildren(...items);
  }

  elements.exerciseAddButton.disabled = list.length >= EXERCISE_MAX_COUNT;
}

function createExerciseButton(action, label, exercise, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'small-btn';
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = exercise.id;
  button.setAttribute('aria-label', ariaLabel);
  return button;
}

// 種目の下の説明文（セット数との関係を伝える）
function renderExerciseHint() {
  const count = settings.exercises.length;
  let text;
  if (count === 0) {
    text = '種目を登録すると、運動のたびに種目名が表示されます。';
  } else if (count >= EXERCISE_MAX_COUNT) {
    text = `種目は最大${EXERCISE_MAX_COUNT}個までです。`;
  } else if (settings.sets % count === 0) {
    text = `${settings.sets}セット = ${count}種目 × ${settings.sets / count}周（上から順に行います）`;
  } else {
    text = `${settings.sets}セットで、${count}種目を上から順にくり返します。`;
  }
  elements.exerciseHint.textContent = text;
}

function render() {
  const { status } = state;
  let phaseType, secondsLeft, progress, setText, nextText;
  let exerciseText = '';      // 種目名の欄に出す文字
  let exerciseIsNext = false; // 「次の種目」として控えめに出すか
  let currentExercise = '';   // ロック画面の題名に使う種目名

  if (status === 'idle') {
    // 待機中：最初のフェーズの秒数を表示しておく
    phaseType = 'idle';
    secondsLeft = settings.prep > 0 ? settings.prep : settings.work;
    progress = 0;
    setText = `全 ${settings.sets} セット`;
    nextText = settings.prep > 0 ? `準備 ${formatDuration(settings.prep)} → 運動スタート` : '開始するとすぐ運動スタート';
    const first = exerciseForSet(settings, 1);
    if (first) {
      exerciseText = `最初の種目：${first}`;
      exerciseIsNext = true;
    }
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

    if (phase.exercise) {
      currentExercise = phase.exercise;
      // 運動中は種目名を大きく、休憩・準備中は「次の種目」として控えめに出す
      exerciseIsNext = phase.type !== 'work';
      exerciseText = exerciseIsNext ? `次の種目：${phase.exercise}` : phase.exercise;
    }
  }

  // --- 文字の表示 ---
  let label = PHASE_LABELS[phaseType];
  if (status === 'paused') label += '（一時停止中）';
  elements.phaseLabel.textContent = label;
  elements.exerciseName.textContent = exerciseText;
  elements.exerciseName.classList.toggle('is-next', exerciseIsNext);
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

  // --- タイマー中は設定と種目をロック ---
  const isActive = status === 'running' || status === 'paused';
  elements.fieldset.disabled = isActive;
  elements.exerciseFieldset.disabled = isActive;

  // --- その他 ---
  const totalSeconds = calcTotalSeconds(settings);
  elements.totalTime.textContent = formatDuration(totalSeconds);
  elements.soundNote.hidden = !(settings.sound && totalSeconds > TRACK_MAX_SECONDS);
  renderExerciseHint();

  // 画面の下のお知らせ（画面ON維持の状態と、音の状態）
  const messages = status === 'running' ? [wakeMessage, soundMessage] : [];
  elements.wakeStatus.textContent = messages.filter(Boolean).join('\n');

  // タブのタイトルにも残り時間を出す（PCで別タブを見ていても分かる）
  document.title = isActive
    ? `${formatTime(secondsLeft)} ${PHASE_LABELS[phaseType]} | HIITタイマー`
    : 'HIITタイマー | 毎日ツール集';

  // ロック画面に出す題名（「運動：スクワット」など）
  if (isActive) {
    const title = currentExercise ? `${PHASE_LABELS[phaseType]}：${currentExercise}` : PHASE_LABELS[phaseType];
    updateMediaSession(title, `HIITタイマー ${setText}`);
  } else {
    updateMediaSession('HIITタイマー', '');
  }
}

/* =========================================================
 * 12. 初期化（ページを開いたときに1回だけ行う）
 * ========================================================= */

function init() {
  writeSettingsToForm();
  renderExerciseList();

  // バイブ非対応の端末ではチェックボックスを押せなくする
  if (!canVibrate) {
    elements.vibrateCheck.disabled = true;
    elements.vibrateLabel.textContent = 'バイブ（この端末は非対応）';
  }

  // 設定の入力欄：'input' は入力のたび、'change' は確定したとき
  elements.fieldset.addEventListener('input', onSettingsChange);
  elements.fieldset.addEventListener('change', onSettingsChange);

  // 種目
  elements.exerciseAddForm.addEventListener('submit', onExerciseAdd);
  elements.exerciseList.addEventListener('click', onExerciseListClick);
  elements.exerciseList.addEventListener('change', onExerciseListChange);

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

  setupMediaSession();
  render();
}

init();
