# 毎日ツール集

スマホとPCで使える小さなツールのまとめ。HTML / CSS / JavaScript のみ（ビルド不要）。

| ツール | フォルダ | 状態 |
|---|---|---|
| HIITタイマー | `hiit-timer/` | 完成 |
| ランニングペース計算機 | `running-pace/` | 完成 |
| 学習時間トラッカー | `study-tracker/` | 完成 |

## フォルダ構成

```
daily-tools/
├── index.html        トップ（ツール一覧）
├── common/           全ツール共通
│   ├── base.css      色（ダーク/ライト）・ボタンなどの見た目
│   ├── storage.js    localStorage の読み書き
│   └── theme.js      テーマ切り替え
├── hiit-timer/       ① HIITタイマー
├── running-pace/     ② ランニングペース計算機
└── study-tracker/    ③ 学習時間トラッカー
```

## ローカルで確認する

`index.html` をダブルクリックしてもだいたい動きますが、
「画面を消さない」機能などは `http://localhost` で開いたときだけ動くため、簡易サーバーでの確認がおすすめです。

```
cd daily-tools
python -m http.server 8765
```

ブラウザで http://localhost:8765/ を開く（止めるときは Ctrl + C）。

## GitHub Pages で公開する

1. GitHub で新しいリポジトリ（例：`daily-tools`）を作る
2. このフォルダの中身をリポジトリに push する
3. リポジトリの Settings → Pages → Branch を `main` / `/(root)` にして Save
4. 数分後、`https://ユーザー名.github.io/daily-tools/` で公開される
