/*
 * theme.js — ダーク／ライトの切り替え（全ツール共通）
 *
 * <html data-theme="dark"> の値を書き換えると、
 * base.css 側で定義した色（CSS変数）が一斉に切り替わる仕組み。
 *
 * このファイルは <head> の中で読み込む。
 * ページが表示される「前」にテーマを決めることで、
 * 一瞬だけ違う色が見える「ちらつき」を防いでいる。
 * （storage.js を先に読み込んでおく必要あり）
 */
(function () {
  const THEME_KEY = 'theme';

  // 保存済みのテーマを読み込む（初回はダーク）
  let currentTheme = Storage.load(THEME_KEY, 'dark');

  // <html> 要素にテーマを設定する
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  }

  // 切り替えボタンの表示を「次に切り替わる先」に合わせる
  function updateButtons() {
    const isDark = currentTheme === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = isDark ? '☀ ライト' : '☾ ダーク';
      button.setAttribute('aria-label', isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
    });
  }

  // すぐにテーマを反映（まだ <body> が無い段階でも <html> は触れる）
  applyTheme(currentTheme);

  // HTML の読み込みが終わってからボタンを準備する
  document.addEventListener('DOMContentLoaded', () => {
    updateButtons();

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(currentTheme);
        Storage.save(THEME_KEY, currentTheme);
        updateButtons();
      });
    });
  });
})();
