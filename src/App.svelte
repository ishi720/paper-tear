<script>
  import DeskView from './lib/DeskView.svelte';
  import PaperStrip from './lib/PaperStrip.svelte';
  import ExportPanel from './lib/ExportPanel.svelte';
  import Results from './lib/Results.svelte';
  import { MAX_PAPERS, loadFile } from './lib/desk.js';
  import { planExport, exportImages } from './lib/exporter.js';

  let engine = $state(null);
  let papers = $state([]);
  let selected = $state(null);
  let seenTouch = 0;
  let canUndo = $state(false);
  let canRedo = $state(false);
  let canReset = $state(false);
  let version = $state(0);

  let mode = $state('tear');
  let exporting = $state(false);
  let unit = $state('piece');
  let background = $state('none');
  let results = $state(null);
  let notice = $state('');

  /**
   * エンジンの状態を画面用の値に写す。机の中身が変わるたびに呼ばれる。
   * 追加・破る・消すをした紙を選び直し、選んでいた紙が削除されたら最後の紙を選ぶ。
   */
  function sync() {
    papers = engine.papers.map((p) => ({ id: p.id, thumb: p.thumb }));
    if (engine.touched.seq !== seenTouch) { seenTouch = engine.touched.seq; selected = engine.touched.paperId; }
    if (!papers.some((p) => p.id === selected)) selected = papers.at(-1)?.id ?? null;
    refresh();
    version++;
  }
  /** 選んでいる紙について、3つのボタンを押せるかを更新する。 */
  function refresh() {
    canUndo = engine.canUndo(selected);
    canRedo = engine.canRedo(selected);
    canReset = engine.canReset(selected);
  }
  /**
   * 紙を選ぶ。
   * @param {number} id 紙の id
   */
  function select(id) { selected = id; refresh(); }

  /**
   * ヒント欄にお知らせを3.5秒だけ出す。
   * @param {string} text
   */
  function say(text) {
    notice = text;
    setTimeout(() => { if (notice === text) notice = ''; }, 3500);
  }

  /**
   * 画像ファイルを紙として机に追加する。上限を超えた分や読めなかったときは、お知らせで伝える。
   * @param {FileList|File[]|null} list
   */
  async function addFiles(list) {
    const files = [...(list || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const room = MAX_PAPERS - engine.papers.length;
    if (room <= 0) { say(`紙は${MAX_PAPERS}枚まで置けます。どれかを削除してから追加してください。`); return; }
    const canvases = (await Promise.all(files.slice(0, room).map(loadFile))).filter(Boolean);
    if (!canvases.length) { say('画像を読み込めませんでした。JPEG か PNG で試してください。'); return; }
    engine.add(canvases);
    if (files.length > room) say(`紙は${MAX_PAPERS}枚まで置けるので、${room}枚だけ追加しました。`);
  }

  const jobCount = $derived.by(() => {
    version;
    return engine && exporting ? planExport(engine, unit).length : 0;
  });

  /** 今の設定で書き出し、結果画面を開く。 */
  async function runExport() {
    results = await exportImages(engine, { unit, background });
  }
  /** 結果画面を閉じ、画像の object URL を解放する。 */
  function closeResults() {
    for (const im of results || []) URL.revokeObjectURL(im.url);
    results = null;
  }

  const hint = $derived(
    notice ||
      (mode === 'erase'
        ? '消したいピースをタップすると、そのピースが消えます。間違えたら「一つ戻す」で戻せます。'
        : '紙の上をなぞると、その線に沿って破れます。重なったピースや隣の紙もまとめて破れます。')
  );

  /**
   * キー操作。Ctrl / ⌘ + Z で一つ戻し、Ctrl / ⌘ + Shift + Z か Ctrl + Y で一つ進め、Esc で結果画面を閉じる。
   * @param {KeyboardEvent} e
   */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); engine?.undo(selected); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); engine?.redo(selected); }
    }
    if (e.key === 'Escape' && results) closeResults();
  }
</script>

<svelte:window onkeydown={onKey} />

<header class="bar">
  <h1>紙を破く</h1>
  <div class="tools">
    <div class="seg mode" role="group" aria-label="操作">
      <button aria-pressed={mode === 'tear'} onclick={() => (mode = 'tear')}>破る</button>
      <button aria-pressed={mode === 'erase'} class:erase-on={mode === 'erase'} onclick={() => (mode = 'erase')}>ピースを消す</button>
    </div>
    <button class="btn" id="undo" disabled={!canUndo} onclick={() => engine.undo(selected)}>一つ戻す</button>
    <button class="btn" id="redo" disabled={!canRedo} onclick={() => engine.redo(selected)}>一つ進める</button>
    <button class="btn" id="reset" disabled={!canReset} onclick={() => engine.reset(selected)}>元に戻す</button>
    <button class="btn" class:on={exporting} aria-pressed={exporting} onclick={() => (exporting = !exporting)}>画像にする</button>
  </div>
</header>

<PaperStrip {papers} {selected} max={MAX_PAPERS} onselect={select} onadd={addFiles} onremove={(id) => engine.remove(id)} />

<p class="hint" class:alert={!!notice}>{hint}</p>

<div class="work">
  <DeskView bind:engine {mode} empty={!papers.length} onchange={sync} onfiles={addFiles} />
  {#if exporting}
    <ExportPanel
      bind:unit
      bind:background
      count={jobCount}
      onexport={runExport}
      onclose={() => (exporting = false)}
    />
  {/if}
</div>

{#if results}
  <Results images={results} onclose={closeResults} />
{/if}
