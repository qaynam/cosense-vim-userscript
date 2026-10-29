# cosense-vim-userscript

Cosense（旧 Scrapbox）のエディタに Vim のキーバインドを足すユーザースクリプトです。
Tampermonkey / Violentmonkey などで動きます。

- ノーマル / インサート / ビジュアル / ビジュアルライン モード
- `w e b` `f t ; ,` `H M L` `gg G` `{ }` などのモーション、`d c y` オペレーター、カウント
- テキストオブジェクト（`iw` `a[` `i"` など）、`.` リピート、マーク、`/ ? n N * #` 検索
- `:e` `:w` `:cpll` `:cpmdl` などのコマンドライン、`:help` で読めるヘルプ
- `nnoremap` / `inoremap` などのキーマップ（設定画面か `:map` 系コマンドで）
- プロジェクトごとの設定（有効 / 無効、テーマ、行番号、IME ガード、カスタム CSS）
- 日本語 IME 対策：ノーマルモードでは IME の入力を止める

## インストール

### URL から（自動更新あり）

Tampermonkey を入れた状態で次の URL を開くと、インストール画面が出ます。

```
https://raw.githubusercontent.com/qaynam/cosense-vim-userscript/main/dist/cosense-vim.user.js
```

[Install to Tampermonkey](https://github.com/qaynam/cosense-vim-userscript/raw/refs/heads/main/dist/cosense-vim.user.js)

### コピペ

[`dist/cosense-vim.user.js`](dist/cosense-vim.user.js) の中身を丸ごとコピーして、Tampermonkey の新規スクリプトに貼り付けます。
[Releases](https://github.com/qaynam/cosense-vim-userscript/releases) にも同じファイルを添付しています。

## 使い方

Cosense のページを開くと、画面下にモード表示が出ます。

| やりたいこと                   | 操作                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| ヘルプを見る                   | `:help`（`:h dd` のようにキーやコマンドで引ける）          |
| 設定を開く                     | `:settings`、または URL に `#vim-settings` を付ける        |
| このプロジェクトだけ無効にする | 設定画面で「このプロジェクト」を選び、有効のチェックを外す |
| キーマップを足す               | 設定画面のキーマップ欄に `inoremap jk <Esc>` のように書く  |

## 開発

Node.js 20 以上と pnpm を使います。

```sh
pnpm install
pnpm dev      # src/ を監視して dist/ を作り直す
pnpm test     # ビルドしてから jsdom 上のテストを実行
pnpm check    # dist/ が src/ と食い違っていないか確認（CI でも実行）
```

ソースは `src/` に分かれていて、`build.mjs` が esbuild で 1 ファイルにまとめ、`package.json` の `userscript` 欄からヘッダーを作ります。
`dist/` はコピペで使えるようにリポジトリに含めているので、`src/` を変えたら `pnpm build` した結果もコミットしてください。
CI は `dist/` が古いままだと失敗します。

開発中に手元で試すときは、Tampermonkey に次のような小さなスクリプトを入れて、ビルド結果を `@require` で読み込むと楽です（Tampermonkey の設定で「ローカルファイルへのアクセス」を許可しておく必要があります）。

```js
// ==UserScript==
// @name     Cosense Vim (dev)
// @match    https://scrapbox.io/*
// @grant    none
// @require  file:///path/to/cosense-vim-userscript/dist/cosense-vim.user.js
// ==/UserScript==
```

## リリース

1. `CHANGELOG.md` に `## v0.32.0` のような見出しで変更点を書いてコミットする
2. `pnpm release minor`（または `patch` / `major` / `0.32.0`）を実行する
   - `package.json` のバージョンが上がり、`dist/` が作り直されて、コミットとタグ `v0.32.0` ができます
   - `CHANGELOG.md` に該当バージョンの節がないと止まります
3. `git push --follow-tags`

タグが push されると GitHub Actions がテストを回し、`dist/cosense-vim.user.js` を添付したリリースを作ります。
リリースノートには `CHANGELOG.md` の該当バージョンの節が入ります。

`npm version` は使えません（`package.json` の `devEngines` で pnpm を指定しているため、npm が実行を拒否します）。

## ライセンス

MIT
