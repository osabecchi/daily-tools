/*
 * storage.js — localStorage の読み書きをまとめた共通部品
 *
 * localStorage は「文字列」しか保存できないため、
 * 保存するときは JSON.stringify で文字列に変換し、
 * 読み込むときは JSON.parse で元のデータ（数値・オブジェクトなど）に戻す。
 *
 * GitHub Pages では「ユーザー名.github.io」配下の全ページが
 * 同じ localStorage を共有するので、キーの先頭に共通の目印（PREFIX）を付けて
 * 他のアプリのデータとぶつからないようにしている。
 */
const Storage = {
  PREFIX: 'dailyTools.',

  // 読み込み：データが無い／壊れている場合は defaultValue を返す
  load(key, defaultValue) {
    try {
      const raw = localStorage.getItem(this.PREFIX + key);
      return raw === null ? defaultValue : JSON.parse(raw);
    } catch (error) {
      // プライベートモードなどで localStorage が使えない時もここに来る
      return defaultValue;
    }
  },

  // 保存：失敗してもアプリが止まらないように try/catch で囲む
  save(key, value) {
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
    } catch (error) {
      console.warn('保存できませんでした:', error);
    }
  },
};
