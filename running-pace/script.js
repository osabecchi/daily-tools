/*
 * script.js — ランニングペース計算機の動き
 *
 * 全体の流れ
 *   1. 前回の入力を localStorage から読み込んで入力欄に戻す
 *   2. 入力が変わるたびに inputs を更新 → 保存 → render() で計算して表示
 *
 * 計算の考え方：どちらのモードも最後は
 *   「距離(km)」「合計時間(秒)」「1kmあたりの秒数」の3つにそろえる。
 *     ペース   = 合計時間 ÷ 距離
 *     完走時間 = ペース × 距離
 *   こうしておくと、時速や通過タイムは同じ処理で出せる。
 */
'use strict';

/* =========================================================
 * 1. 定数と状態
 * ========================================================= */

const STORAGE_KEY = 'runningPace.inputs';

// 初めて開いたときの入力値。
// 入力欄の中身は「文字」として持っておく（空欄を空欄のまま保存できるように）
const DEFAULT_INPUTS = {
  mode: 'pace',        // 'pace'(ペースを計算) / 'finish'(完走時間を計算)
  distance: '10',
  hours: '0',
  minutes: '55',
  seconds: '0',
  paceMinutes: '5',
  paceSeconds: '30',
};

// 保存済みの値で初期値を上書きする
const inputs = { ...DEFAULT_INPUTS, ...Storage.load(STORAGE_KEY, {}) };

/* =========================================================
 * 2. 画面の部品
 * ========================================================= */

const elements = {
  form: document.getElementById('calcForm'),
  tabs: document.querySelectorAll('.tab'),
  presets: document.querySelectorAll('.preset'),
  distanceInput: document.getElementById('distanceInput'),
  timeGroup: document.getElementById('timeGroup'),
  paceGroup: document.getElementById('paceGroup'),
  resultLabel: document.getElementById('resultLabel'),
  resultValue: document.getElementById('resultValue'),
  resultUnit: document.getElementById('resultUnit'),
  resultSub: document.getElementById('resultSub'),
  splitsSection: document.getElementById('splitsSection'),
  splitsBody: document.getElementById('splitsBody'),
};

/* =========================================================
 * 3. 便利関数
 * ========================================================= */

// 入力された文字を数値にする。空欄・マイナス・数字以外は 0 として扱う
function toNumber(text) {
  const number = parseFloat(text);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// 2桁にそろえる（5 → "05"）
function pad2(number) {
  return String(number).padStart(2, '0');
}

// 秒数を時計の形にする
//   1時間未満 → "5:30"、1時間以上 → "1:52:30"
function formatClock(totalSeconds) {
  // 先に四捨五入しておく。
  // 後で丸めると「5:59.6 → 5:60」のような表示になってしまうため
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${minutes}:${pad2(seconds)}`;
}

// 距離を表示用の文字にする（21.0975 → "21.0975"、5 → "5"）
// toFixed で小数の誤差（0.1+0.2=0.30000000000000004 のようなもの）を消してから数値に戻す
function formatKm(km) {
  return String(parseFloat(km.toFixed(4)));
}

/* =========================================================
 * 4. 計算
 * ========================================================= */

// 今の入力から結果を計算する。入力が足りなければ null を返す
function calculate() {
  const distance = toNumber(inputs.distance);

  if (inputs.mode === 'pace') {
    // ペースを計算：合計時間 ÷ 距離
    const totalSeconds =
      toNumber(inputs.hours) * 3600 + toNumber(inputs.minutes) * 60 + toNumber(inputs.seconds);
    if (distance === 0 || totalSeconds === 0) return null;
    return { distance, totalSeconds, paceSeconds: totalSeconds / distance };
  }

  // 完走時間を計算：ペース × 距離
  const paceSeconds = toNumber(inputs.paceMinutes) * 60 + toNumber(inputs.paceSeconds);
  if (distance === 0 || paceSeconds === 0) return null;
  return { distance, paceSeconds, totalSeconds: paceSeconds * distance };
}

// 時速(km/h)：距離 ÷ 時間(時)
function calcSpeed(result) {
  return result.distance / (result.totalSeconds / 3600);
}

// 通過タイム表の行を作る
// 10km以下なら1kmごと、50km以下なら5kmごと、それより長ければ10kmごと
function buildSplits(distance, paceSeconds) {
  let step = distance <= 10 ? 1 : distance <= 50 ? 5 : 10;
  // とても長い距離でも表が100行を超えないようにする
  step = Math.max(step, Math.ceil(distance / 100));

  const rows = [];
  // 「ゴールとほぼ同じ距離」の行は作らない（0.000001 は小数の誤差よけ）
  for (let km = step; km < distance - 0.000001; km += step) {
    rows.push({ km, seconds: km * paceSeconds, isGoal: false });
  }
  rows.push({ km: distance, seconds: distance * paceSeconds, isGoal: true });
  return rows;
}

/* =========================================================
 * 5. 表示
 * ========================================================= */

function render() {
  const isPaceMode = inputs.mode === 'pace';

  // --- タブの見た目と、入力グループの表示切り替え ---
  elements.tabs.forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === inputs.mode));
  });
  elements.timeGroup.hidden = !isPaceMode;   // hidden = true で非表示
  elements.paceGroup.hidden = isPaceMode;

  // --- 今の距離と同じプリセットボタンを強調 ---
  const distance = toNumber(inputs.distance);
  elements.presets.forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.km) === distance);
  });

  // --- 結果 ---
  const result = calculate();
  elements.resultLabel.textContent = isPaceMode ? '1kmあたりのペース' : '完走時間';

  if (result === null) {
    elements.resultValue.textContent = '—';
    elements.resultUnit.textContent = '';
    elements.resultSub.textContent = isPaceMode
      ? '距離と時間を入力してください'
      : '距離とペースを入力してください';
    elements.splitsSection.hidden = true;
    return;  // ここで終了（下の処理はしない）
  }

  const speedText = `時速 ${calcSpeed(result).toFixed(1)} km`;

  if (isPaceMode) {
    elements.resultValue.textContent = formatClock(result.paceSeconds);
    elements.resultUnit.textContent = '/km';
    elements.resultSub.textContent = speedText;
  } else {
    elements.resultValue.textContent = formatClock(result.totalSeconds);
    elements.resultUnit.textContent = '';
    elements.resultSub.textContent = `${formatClock(result.paceSeconds)} /km ・ ${speedText}`;
  }

  renderSplits(result);
}

// 通過タイム表を作り直す
function renderSplits(result) {
  const rows = buildSplits(result.distance, result.paceSeconds);

  // 1行ずつ <tr> を作る。
  // innerHTML ではなく textContent で文字を入れると、入力内容がHTMLとして解釈される心配がない
  const fragment = document.createDocumentFragment();  // まとめて追加するための入れ物
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    if (row.isGoal) tr.className = 'is-goal';

    const kmCell = document.createElement('td');
    kmCell.textContent = row.isGoal ? `${formatKm(row.km)} km（ゴール）` : `${formatKm(row.km)} km`;

    const timeCell = document.createElement('td');
    timeCell.textContent = formatClock(row.seconds);

    tr.append(kmCell, timeCell);
    fragment.append(tr);
  });

  elements.splitsBody.replaceChildren(fragment);  // 古い行を消して新しい行に入れ替える
  elements.splitsSection.hidden = false;
}

/* =========================================================
 * 6. 入力の受け取り
 * ========================================================= */

function save() {
  Storage.save(STORAGE_KEY, inputs);
}

// inputs の値を入力欄に表示する（ページを開いたとき用）
function writeInputsToForm() {
  elements.form.querySelectorAll('[data-key]').forEach((input) => {
    input.value = inputs[input.dataset.key];
  });
}

function init() {
  writeInputsToForm();

  // 入力欄が変わったとき：data-key の名前で inputs を更新する
  // （入力欄ごとにイベントを付けず、form 1か所でまとめて受け取っている）
  elements.form.addEventListener('input', (event) => {
    const key = event.target.dataset.key;
    if (!key) return;
    inputs[key] = event.target.value;
    save();
    render();
  });

  // Enter キーでフォームが送信され、ページが再読み込みされるのを防ぐ
  elements.form.addEventListener('submit', (event) => event.preventDefault());

  // タブ：モードを切り替える
  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      inputs.mode = tab.dataset.mode;
      save();
      render();
    });
  });

  // 距離のワンタップボタン
  elements.presets.forEach((button) => {
    button.addEventListener('click', () => {
      inputs.distance = button.dataset.km;
      elements.distanceInput.value = button.dataset.km;
      save();
      render();
    });
  });

  render();
}

init();
