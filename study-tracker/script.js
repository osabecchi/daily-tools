/*
 * script.js — 学習時間トラッカーの動き
 *
 * 全体の流れ
 *   1. localStorage から「言語の一覧」と「記録の一覧」を読み込む
 *   2. 記録（手入力 or 計測タイマー）を追加したら保存して renderAll() で画面を作り直す
 *   3. 週グラフは「表示中の週の月曜日」を基準に、7日分の記録を集計して描く
 *
 * データの形
 *   data = {
 *     languages: [{ id, name, color, hidden }],
 *     records:   [{ id, date: "2026-10-01", languageId, minutes, memo }]
 *   }
 *   記録には言語の「名前」ではなく「id」を入れておく。
 *   こうすると言語名を変えても、過去の記録はそのまま正しく紐づく。
 */
'use strict';

/* =========================================================
 * 1. 定数
 * ========================================================= */

const DATA_KEY = 'studyTracker.data';          // 言語と記録
const TIMER_KEY = 'studyTracker.timer';        // 計測タイマーの状態
const LAST_LANGUAGE_KEY = 'studyTracker.lastLanguage'; // 最後に選んだ言語

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']; // getDay() の 0〜6 に対応
const MAX_MINUTES = 24 * 60;  // 1回の記録の上限（24時間）
const MEMO_MAX = 100;

// 初めて開いたときの言語
const DEFAULT_LANGUAGES = [
  { id: 'html-css', name: 'HTML/CSS', color: '#f76707', hidden: false },
  { id: 'javascript', name: 'JavaScript', color: '#fab005', hidden: false },
  { id: 'java', name: 'Java', color: '#e64980', hidden: false },
  { id: 'python', name: 'Python', color: '#4c6ef5', hidden: false },
];

// 言語を追加するときに順番に使う色
const COLOR_PALETTE = ['#12b886', '#7950f2', '#15aabf', '#be4bdb', '#82c91e', '#fd7e14', '#868e96'];

// 削除などで言語が見つからない記録に使う仮の言語
const UNKNOWN_LANGUAGE = { id: '', name: '（不明）', color: '#868e96', hidden: true };

/* =========================================================
 * 2. 状態
 * ========================================================= */

let data = loadData();
// 計測タイマー：null なら計測していない
// { languageId, startDate, startedAt(動いている時は開始時刻・止まっている時は null), accumulatedMs(これまでの合計) }
let timer = Storage.load(TIMER_KEY, null);
let weekStart = getMonday(new Date());  // グラフに表示している週の月曜日
let toastTimerId = null;

function loadData() {
  const saved = Storage.load(DATA_KEY, null);
  if (saved && Array.isArray(saved.languages) && Array.isArray(saved.records)) {
    return saved;
  }
  // 保存データが無ければ初期状態を作る。
  // DEFAULT_LANGUAGES をそのまま使うと、後で書き換えたときに定数まで変わってしまうので、
  // { ...lang } で1つずつコピーしている
  return { languages: DEFAULT_LANGUAGES.map((lang) => ({ ...lang })), records: [] };
}

function saveData() {
  Storage.save(DATA_KEY, data);
}

function saveTimer() {
  Storage.save(TIMER_KEY, timer);
}

/* =========================================================
 * 3. 画面の部品
 * ========================================================= */

const elements = {
  languageSelect: document.getElementById('languageSelect'),
  stopwatch: document.querySelector('.stopwatch'),
  stopwatchStatus: document.getElementById('stopwatchStatus'),
  stopwatchTime: document.getElementById('stopwatchTime'),
  stopwatchMain: document.getElementById('stopwatchMain'),
  stopwatchFinish: document.getElementById('stopwatchFinish'),
  stopwatchDiscard: document.getElementById('stopwatchDiscard'),
  recordForm: document.getElementById('recordForm'),
  dateInput: document.getElementById('dateInput'),
  hoursInput: document.getElementById('hoursInput'),
  minutesInput: document.getElementById('minutesInput'),
  memoInput: document.getElementById('memoInput'),
  addButton: document.getElementById('addButton'),
  quickAddButtons: document.querySelectorAll('[data-add]'),
  prevWeek: document.getElementById('prevWeek'),
  nextWeek: document.getElementById('nextWeek'),
  thisWeek: document.getElementById('thisWeek'),
  weekRange: document.getElementById('weekRange'),
  weekTotal: document.getElementById('weekTotal'),
  weekAverage: document.getElementById('weekAverage'),
  chart: document.getElementById('chart'),
  breakdown: document.getElementById('breakdown'),
  recordList: document.getElementById('recordList'),
  languageList: document.getElementById('languageList'),
  languageAddForm: document.getElementById('languageAddForm'),
  newLanguageName: document.getElementById('newLanguageName'),
  newLanguageColor: document.getElementById('newLanguageColor'),
  exportButton: document.getElementById('exportButton'),
  importButton: document.getElementById('importButton'),
  importFile: document.getElementById('importFile'),
  toast: document.getElementById('toast'),
};

/* =========================================================
 * 4. 便利関数（日付・時間・ID）
 * ========================================================= */

function pad2(number) {
  return String(number).padStart(2, '0');
}

// Date → "2026-10-01"
// 【注意】toISOString() は世界標準時(UTC)で日付を作るため、
// 日本時間の朝9時前に使うと「前の日」になってしまう。だから自分で組み立てる。
function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// "2026-10-01" → Date（その日の0時0分）
function fromDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);  // 月だけは 0 始まり（1月 = 0）
}

// days 日後の日付。月末をまたいでも Date が自動で繰り上げてくれる（10/31 + 1 → 11/1）
function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// その日が含まれる週の月曜日
// getDay() は 日=0, 月=1 … 土=6。「月曜から何日たったか」は (getDay() + 6) % 7 で求まる
function getMonday(date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// 分 → "1時間30分" / "45分" / "2時間"
function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

// 分 → グラフ用の短い表示 "45分" / "1.5h"
function formatShort(minutes) {
  return minutes < 60 ? `${minutes}分` : `${parseFloat((minutes / 60).toFixed(1))}h`;
}

// ミリ秒 → "1:05:09"
function formatClock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
}

// 文字 → 0以上の整数（空欄や変な値は 0）
function toInt(text) {
  const number = parseInt(text, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// 記録や言語を見分けるための ID を作る（時刻 + ランダムな文字）
function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* =========================================================
 * 5. 言語まわりの便利関数
 * ========================================================= */

function findLanguage(id) {
  return data.languages.find((lang) => lang.id === id);
}

// 見つからなければ「（不明）」を返す（表示が壊れないように）
function getLanguage(id) {
  return findLanguage(id) || UNKNOWN_LANGUAGE;
}

function visibleLanguages() {
  return data.languages.filter((lang) => !lang.hidden);
}

function countRecords(languageId) {
  return data.records.filter((record) => record.languageId === languageId).length;
}

function nextPaletteColor() {
  return COLOR_PALETTE[data.languages.length % COLOR_PALETTE.length];
}

// 言語の並び順（グラフの積み順と内訳の順をそろえるため）
function languageOrder(id) {
  const index = data.languages.findIndex((lang) => lang.id === id);
  return index === -1 ? Infinity : index;  // 不明な言語は最後
}

// 色付きの丸を作る
function createColorDot(color) {
  const dot = document.createElement('span');
  dot.className = 'color-dot';
  dot.style.background = color;
  return dot;
}

/* =========================================================
 * 6. お知らせ（トースト）
 * ========================================================= */

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  // 前のお知らせのタイマーが残っていたら止めてから、2.5秒後に消す
  clearTimeout(toastTimerId);
  toastTimerId = setTimeout(() => elements.toast.classList.remove('is-visible'), 2500);
}

/* =========================================================
 * 7. 記録の追加・削除
 * ========================================================= */

function addRecord({ date, languageId, minutes, memo }) {
  data.records.push({ id: createId(), date, languageId, minutes, memo });
  saveData();
  weekStart = getMonday(fromDateKey(date));  // 記録した日の週を表示する
  renderAll();
}

function deleteRecord(id) {
  // filter：条件に合うものだけ残した新しい配列を作る＝id が一致するものを取り除く
  data.records = data.records.filter((record) => record.id !== id);
  saveData();
  renderAll();
}

/* ----- 手入力 ----- */

function readDurationMinutes() {
  return toInt(elements.hoursInput.value) * 60 + toInt(elements.minutesInput.value);
}

// 合計の分数を「時間」と「分」の欄に分けて入れる（90分 → 1時間 30分）
function setDuration(totalMinutes) {
  elements.hoursInput.value = Math.floor(totalMinutes / 60);
  elements.minutesInput.value = totalMinutes % 60;
}

function onRecordSubmit(event) {
  event.preventDefault();  // フォーム送信でページが再読み込みされるのを止める

  const languageId = elements.languageSelect.value;
  const minutes = readDurationMinutes();
  const date = elements.dateInput.value;

  // 入力チェック：問題があればお知らせを出して終了
  if (!languageId) return showToast('先に言語を追加してください');
  if (!date) return showToast('日付を入力してください');
  if (minutes <= 0) return showToast('時間を入力してください');
  if (minutes > MAX_MINUTES) return showToast('1回の記録は24時間までです');

  addRecord({ date, languageId, minutes, memo: elements.memoInput.value.trim() });
  showToast(`${getLanguage(languageId).name} ${formatMinutes(minutes)} を記録しました`);

  // 次の入力に備えて時間とメモを空にする（日付と言語はそのまま）
  setDuration(0);
  elements.memoInput.value = '';
}

/* ----- 計測タイマー ----- */

// 計った時間 = これまでの合計 + （動いていれば）今回動き始めてからの時間
// 開始時刻を localStorage に保存しているので、ページを閉じても計測は続く
function getElapsedMs() {
  if (!timer) return 0;
  const runningMs = timer.startedAt ? Date.now() - timer.startedAt : 0;
  return timer.accumulatedMs + runningMs;
}

// メインボタン：開始 → 一時停止 → 再開 → 一時停止 …
function onStopwatchMain() {
  if (!timer) {
    const languageId = elements.languageSelect.value;
    if (!languageId) return showToast('先に言語を追加してください');
    timer = {
      languageId,                         // 開始時の言語を覚えておく
      startDate: toDateKey(new Date()),   // 日付をまたいでも「始めた日」に記録する
      startedAt: Date.now(),
      accumulatedMs: 0,
    };
  } else if (timer.startedAt) {
    // 一時停止：ここまでの時間を合計に足して、開始時刻を空にする
    timer.accumulatedMs += Date.now() - timer.startedAt;
    timer.startedAt = null;
  } else {
    // 再開
    timer.startedAt = Date.now();
  }
  saveTimer();
  renderStopwatch();
}

function onStopwatchFinish() {
  if (!timer) return;
  const minutes = Math.round(getElapsedMs() / 60000);  // ミリ秒 → 分（四捨五入）

  if (minutes < 1) {
    if (confirm('30秒未満のため記録できません。計測を破棄しますか？')) clearTimer();
    return;
  }
  // 止め忘れの可能性があるときは確認する
  if (minutes > 12 * 60 && !confirm(`${formatMinutes(minutes)} を記録します。よろしいですか？`)) {
    return;
  }

  const recordMinutes = Math.min(minutes, MAX_MINUTES);
  addRecord({
    date: timer.startDate,
    languageId: timer.languageId,
    minutes: recordMinutes,
    memo: elements.memoInput.value.trim(),
  });
  showToast(`${getLanguage(timer.languageId).name} ${formatMinutes(recordMinutes)} を記録しました`);
  elements.memoInput.value = '';
  clearTimer();
}

function onStopwatchDiscard() {
  if (timer && confirm('計測中の時間を破棄しますか？')) clearTimer();
}

function clearTimer() {
  timer = null;
  saveTimer();
  renderStopwatch();
}

/* =========================================================
 * 8. 言語の管理
 * ========================================================= */

function onLanguageAdd(event) {
  event.preventDefault();
  const name = elements.newLanguageName.value.trim();
  if (!name) return;

  // 同じ名前が既にあれば追加しない（大文字・小文字は区別しない）
  const exists = data.languages.some((lang) => lang.name.toLowerCase() === name.toLowerCase());
  if (exists) return showToast(`「${name}」は既にあります`);

  const language = { id: createId(), name, color: elements.newLanguageColor.value, hidden: false };
  data.languages.push(language);
  saveData();

  elements.languageSelect.value = language.id;  // 追加した言語を選んだ状態にする
  Storage.save(LAST_LANGUAGE_KEY, language.id);
  elements.newLanguageName.value = '';
  elements.newLanguageColor.value = nextPaletteColor();
  renderAll();
  showToast(`「${name}」を追加しました`);
}

// 言語の一覧のボタン（削除／非表示／表示）
// 一覧は作り直されるので、ボタン1つ1つではなく親の <ul> でまとめてクリックを受け取る（イベント委任）
function onLanguageListClick(event) {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const language = findLanguage(button.dataset.id);
  if (!language) return;

  if (timer && timer.languageId === language.id) {
    return showToast('計測中の言語は変更できません');
  }

  if (countRecords(language.id) === 0) {
    // 記録が無い言語は本当に削除する
    if (!confirm(`「${language.name}」を削除しますか？`)) return;
    data.languages = data.languages.filter((lang) => lang.id !== language.id);
  } else {
    // 記録がある言語は「非表示」と「表示」を切り替えるだけ
    language.hidden = !language.hidden;
  }
  saveData();
  renderAll();
}

// 言語名・色の変更（'change' は入力が確定したときに起きる）
function onLanguageListChange(event) {
  const input = event.target;
  const language = findLanguage(input.dataset.id);
  if (!language) return;

  if (input.type === 'color') {
    language.color = input.value;
  } else {
    const name = input.value.trim();
    if (name) language.name = name;  // 空欄にされたら元の名前のまま
  }
  saveData();
  renderAll();
}

/* =========================================================
 * 9. データの書き出し・読み込み
 * ========================================================= */

function exportData() {
  // JSON.stringify の 3つ目の引数 2：読みやすいように2文字ずつ字下げする
  const json = JSON.stringify({ app: 'study-tracker', version: 1, ...data }, null, 2);

  // 文字列をファイル（Blob）にして、一時的なリンクからダウンロードさせる
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `study-tracker-${toDateKey(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);  // 使い終わった一時リンクを片付ける
}

// async / await：ファイルの読み込みのように「待ち」がある処理を、上から順に書ける
async function onImportFile() {
  const file = elements.importFile.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);  // 形式が壊れていたらここでエラー → catch へ
    const result = mergeData(imported);
    saveData();
    renderAll();
    showToast(`記録 ${result.recordsAdded}件・言語 ${result.languagesAdded}件を追加しました`);
  } catch (error) {
    showToast('読み込めませんでした（ファイルの形式が違います）');
  } finally {
    // 同じファイルをもう一度選んでも反応するように、選択を空にしておく
    elements.importFile.value = '';
  }
}

// 読み込んだデータを今のデータに「合体」する（今ある記録は消さない）
function mergeData(imported) {
  if (!imported || !Array.isArray(imported.languages) || !Array.isArray(imported.records)) {
    throw new Error('形式が違います');
  }

  // 読み込んだ言語の id → この端末の言語の id、の対応表
  // 別々の端末で同じ名前の言語を作ると id が違うので、名前が同じなら同じ言語として扱う
  const idMap = {};
  let languagesAdded = 0;

  imported.languages.forEach((lang) => {
    if (typeof lang.id !== 'string' || typeof lang.name !== 'string') return;
    const sameId = findLanguage(lang.id);
    const sameName = data.languages.find((l) => l.name.toLowerCase() === lang.name.toLowerCase());

    if (sameId) {
      idMap[lang.id] = sameId.id;
    } else if (sameName) {
      idMap[lang.id] = sameName.id;
    } else {
      const color = /^#[0-9a-f]{6}$/i.test(lang.color) ? lang.color : nextPaletteColor();
      data.languages.push({ id: lang.id, name: lang.name.slice(0, 20), color, hidden: Boolean(lang.hidden) });
      idMap[lang.id] = lang.id;
      languagesAdded++;
    }
  });

  // Set：重複しない値の集まり。has() で「もう持っているか」を素早く調べられる
  const existingIds = new Set(data.records.map((record) => record.id));
  let recordsAdded = 0;

  imported.records.forEach((record) => {
    const isValid =
      typeof record.id === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&    // "2026-10-01" の形か
      Number.isInteger(record.minutes) &&
      record.minutes > 0 &&
      record.minutes <= MAX_MINUTES &&
      idMap[record.languageId];
    if (!isValid || existingIds.has(record.id)) return;  // 変なデータ・既にある記録は飛ばす

    data.records.push({
      id: record.id,
      date: record.date,
      languageId: idMap[record.languageId],
      minutes: record.minutes,
      memo: typeof record.memo === 'string' ? record.memo.slice(0, MEMO_MAX) : '',
    });
    existingIds.add(record.id);
    recordsAdded++;
  });

  return { recordsAdded, languagesAdded };
}

/* =========================================================
 * 10. 表示
 * ========================================================= */

function renderAll() {
  renderLanguageSelect();
  renderStopwatch();
  renderWeek();
  renderLanguageManager();
}

// 言語の選択欄（非表示の言語は出さない）
function renderLanguageSelect() {
  const select = elements.languageSelect;
  const previous = select.value || Storage.load(LAST_LANGUAGE_KEY, '');
  const languages = visibleLanguages();

  select.replaceChildren(
    ...languages.map((lang) => new Option(lang.name, lang.id))  // new Option(表示名, 値)
  );
  if (languages.some((lang) => lang.id === previous)) {
    select.value = previous;
  }
  elements.addButton.disabled = languages.length === 0;
}

function renderStopwatch() {
  const isRunning = Boolean(timer && timer.startedAt);

  elements.stopwatchTime.textContent = formatClock(getElapsedMs());
  elements.stopwatch.classList.toggle('is-running', isRunning);

  if (!timer) {
    elements.stopwatchStatus.textContent = '勉強を始めるときに押してください';
    elements.stopwatchMain.textContent = '計測開始';
  } else {
    const name = getLanguage(timer.languageId).name;
    elements.stopwatchStatus.textContent = `${isRunning ? '計測中' : '一時停止中'}：${name}`;
    elements.stopwatchMain.textContent = isRunning ? '一時停止' : '再開';
  }

  elements.stopwatchMain.disabled = !timer && visibleLanguages().length === 0;
  elements.stopwatchFinish.disabled = !timer;
  elements.stopwatchDiscard.disabled = !timer;
}

function renderWeek() {
  // 表示する週の7日分（月〜日）
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const dayKeys = days.map(toDateKey);
  const todayKey = toDateKey(new Date());

  // "2026-10-01" の形の文字列は、文字の大小比較がそのまま日付の前後になる
  const weekRecords = data.records.filter(
    (record) => record.date >= dayKeys[0] && record.date <= dayKeys[6]
  );

  // --- 週の見出し ---
  elements.weekRange.textContent =
    `${days[0].getFullYear()}/${formatMonthDay(days[0])} 〜 ${formatMonthDay(days[6])}`;
  elements.thisWeek.hidden = dayKeys[0] === toDateKey(getMonday(new Date()));

  // --- 集計：日ごと × 言語ごとの合計分数 ---
  //   perDay = { "2026-09-28": { javascript: 30, java: 60 }, ... }
  const perDay = {};
  dayKeys.forEach((key) => { perDay[key] = {}; });
  const perLanguage = {};  // 週全体の言語ごとの合計

  weekRecords.forEach((record) => {
    const day = perDay[record.date];
    day[record.languageId] = (day[record.languageId] || 0) + record.minutes;
    perLanguage[record.languageId] = (perLanguage[record.languageId] || 0) + record.minutes;
  });

  // 日ごとの合計：Object.values で { a: 30, b: 60 } → [30, 60] にして足す
  const dayTotals = dayKeys.map((key) =>
    Object.values(perDay[key]).reduce((sum, minutes) => sum + minutes, 0)
  );
  const weekTotal = dayTotals.reduce((sum, minutes) => sum + minutes, 0);

  elements.weekTotal.textContent = formatMinutes(weekTotal);
  elements.weekAverage.textContent = weekTotal > 0 ? `1日平均 ${formatMinutes(Math.round(weekTotal / 7))}` : '';

  renderChart(days, dayKeys, perDay, dayTotals, todayKey);
  renderBreakdown(perLanguage, weekTotal);
  renderRecordList(weekRecords);
}

// 棒グラフ
function renderChart(days, dayKeys, perDay, dayTotals, todayKey) {
  // 一番長い日を棒の高さ100%にする。
  // ただし少ない日しかない週で棒が伸びすぎないよう、最低でも「1時間 = 100%」にする
  const scale = Math.max(...dayTotals, 60);

  const columns = days.map((date, i) => {
    const key = dayKeys[i];
    const total = dayTotals[i];

    const column = document.createElement('div');
    column.className = 'day';
    if (key === todayKey) column.classList.add('is-today');

    const totalLabel = document.createElement('div');
    totalLabel.className = 'day-total';
    totalLabel.textContent = total > 0 ? formatShort(total) : '';

    const barArea = document.createElement('div');
    barArea.className = 'bar-area';

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${(total / scale) * 100}%`;  // 棒全体の高さ

    // 言語ごとの区切りを積み上げる
    Object.entries(perDay[key])                        // [[言語id, 分], ...]
      .sort((a, b) => languageOrder(a[0]) - languageOrder(b[0]))
      .forEach(([languageId, minutes]) => {
        const language = getLanguage(languageId);
        const segment = document.createElement('div');
        segment.className = 'bar-segment';
        segment.style.flexGrow = minutes;              // 分数の比率で高さを分ける
        segment.style.background = language.color;
        segment.title = `${language.name} ${formatMinutes(minutes)}`;  // マウスを乗せると出る説明
        bar.append(segment);
      });

    barArea.append(bar);

    const dayLabel = document.createElement('div');
    dayLabel.className = 'day-label';
    dayLabel.textContent = `${WEEKDAYS[date.getDay()]}\n${formatMonthDay(date)}`;

    column.append(totalLabel, barArea, dayLabel);
    return column;
  });

  elements.chart.replaceChildren(...columns);
}

// 言語別の内訳
function renderBreakdown(perLanguage, weekTotal) {
  if (weekTotal === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'この週の記録はまだありません';
    elements.breakdown.replaceChildren(empty);
    return;
  }

  // 時間が長い順に並べる
  const rows = Object.entries(perLanguage)
    .sort((a, b) => b[1] - a[1])
    .map(([languageId, minutes]) => {
      const language = getLanguage(languageId);
      const percent = Math.round((minutes / weekTotal) * 100);

      const row = document.createElement('div');
      row.className = 'breakdown-row';

      const name = document.createElement('span');
      name.className = 'breakdown-name';
      name.append(createColorDot(language.color), language.name);

      const track = document.createElement('div');
      track.className = 'breakdown-track';
      const fill = document.createElement('div');
      fill.className = 'breakdown-fill';
      fill.style.width = `${percent}%`;
      fill.style.background = language.color;
      track.append(fill);

      const value = document.createElement('span');
      value.className = 'breakdown-value';
      value.textContent = `${formatMinutes(minutes)} ${percent}%`;

      row.append(name, track, value);
      return row;
    });

  elements.breakdown.replaceChildren(...rows);
}

// この週の記録一覧（新しい順）
function renderRecordList(weekRecords) {
  if (weekRecords.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'この週の記録はまだありません';
    elements.recordList.replaceChildren(empty);
    return;
  }

  // 追加した順に並んでいるので、まず逆順（新しい順）にしてから日付の新しい順に並べ替える
  // （sort は同じ日付どうしの順番を変えないので、同じ日の中では新しい記録が上になる）
  const sorted = [...weekRecords].reverse().sort((a, b) => b.date.localeCompare(a.date));

  const items = sorted.map((record) => {
    const language = getLanguage(record.languageId);
    const date = fromDateKey(record.date);

    const item = document.createElement('li');
    item.className = 'record-item';

    const main = document.createElement('div');
    main.className = 'record-main';

    const dateText = document.createElement('span');
    dateText.className = 'record-date';
    dateText.textContent = `${formatMonthDay(date)}（${WEEKDAYS[date.getDay()]}）`;

    const lang = document.createElement('span');
    lang.className = 'record-lang';
    lang.append(createColorDot(language.color), language.name);

    const minutes = document.createElement('span');
    minutes.className = 'record-minutes';
    minutes.textContent = formatMinutes(record.minutes);

    main.append(dateText, lang, minutes);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'small-btn';
    deleteButton.textContent = '削除';
    deleteButton.dataset.deleteId = record.id;  // HTML では data-delete-id="..." になる

    item.append(main, deleteButton);

    if (record.memo) {
      const memo = document.createElement('p');
      memo.className = 'record-memo';
      // メモは利用者が入力した文字なので、必ず textContent で入れる
      // （innerHTML だと <script> などがHTMLとして動いてしまう危険がある）
      memo.textContent = record.memo;
      item.append(memo);
    }
    return item;
  });

  elements.recordList.replaceChildren(...items);
}

// 言語の管理の一覧
function renderLanguageManager() {
  const items = data.languages.map((language) => {
    const item = document.createElement('li');
    item.className = 'language-item';
    if (language.hidden) item.classList.add('is-hidden');

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = language.color;
    colorInput.dataset.id = language.id;
    colorInput.setAttribute('aria-label', `${language.name} の色`);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = language.name;
    nameInput.maxLength = 20;
    nameInput.dataset.id = language.id;
    nameInput.setAttribute('aria-label', '言語名');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small-btn';
    button.dataset.id = language.id;
    const count = countRecords(language.id);
    button.textContent = count === 0 ? '削除' : language.hidden ? '表示' : '非表示';

    item.append(colorInput, nameInput, button);
    return item;
  });

  elements.languageList.replaceChildren(...items);
}

/* =========================================================
 * 11. 初期化
 * ========================================================= */

function init() {
  elements.dateInput.value = toDateKey(new Date());  // 日付の初期値は今日
  elements.newLanguageColor.value = nextPaletteColor();

  // --- 記録する ---
  elements.languageSelect.addEventListener('change', () => {
    Storage.save(LAST_LANGUAGE_KEY, elements.languageSelect.value);
  });
  elements.recordForm.addEventListener('submit', onRecordSubmit);
  elements.quickAddButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const add = Number(button.dataset.add);
      // 「0に戻す」は data-add="0"
      setDuration(add === 0 ? 0 : Math.min(readDurationMinutes() + add, MAX_MINUTES));
    });
  });

  // --- 計測タイマー ---
  elements.stopwatchMain.addEventListener('click', onStopwatchMain);
  elements.stopwatchFinish.addEventListener('click', onStopwatchFinish);
  elements.stopwatchDiscard.addEventListener('click', onStopwatchDiscard);
  // 計測中だけ、0.5秒ごとに表示を更新する
  setInterval(() => {
    if (timer && timer.startedAt) renderStopwatch();
  }, 500);

  // --- 週の切り替え ---
  elements.prevWeek.addEventListener('click', () => {
    weekStart = addDays(weekStart, -7);
    renderWeek();
  });
  elements.nextWeek.addEventListener('click', () => {
    weekStart = addDays(weekStart, 7);
    renderWeek();
  });
  elements.thisWeek.addEventListener('click', () => {
    weekStart = getMonday(new Date());
    renderWeek();
  });

  // --- 記録の削除（一覧の親でまとめて受け取る） ---
  elements.recordList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-id]');
    if (button && confirm('この記録を削除しますか？')) {
      deleteRecord(button.dataset.deleteId);
    }
  });

  // --- 言語の管理 ---
  elements.languageAddForm.addEventListener('submit', onLanguageAdd);
  elements.languageList.addEventListener('click', onLanguageListClick);
  elements.languageList.addEventListener('change', onLanguageListChange);

  // --- データ ---
  elements.exportButton.addEventListener('click', exportData);
  elements.importButton.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', onImportFile);

  renderAll();
}

init();
