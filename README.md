# 紙を破く（paper-tear）

紙をなぞった線に沿って破り、画像に書き出すツールです。

## 使い方

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # dist/index.html に1ファイルでビルド
```

## 構成

- `src/App.svelte` 画面全体と状態（追加・削除・元に戻す・書き出しの設定）
- `src/lib/DeskView.svelte` 机のキャンバスと操作（破る／タップで選ぶ／四角で囲む）
- `src/lib/PaperStrip.svelte` 紙の一覧、追加と削除
- `src/lib/ExportPanel.svelte` 「画像にする」の単位・範囲・背景
- `src/lib/Results.svelte` 書き出した画像の一覧
- `src/lib/desk.js` 破るアルゴリズムと描画エンジン（Svelte に依存しない素の JS）
- `src/lib/exporter.js` 書き出し処理（単位：ピース／紙／机全体）
- `src/lib/save.js` 名前を付けて保存（claude.ai では downloads 機能、それ以外では通常のダウンロード）と ZIP 作成
