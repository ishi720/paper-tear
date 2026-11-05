<script>
  import DeskView from './lib/DeskView.svelte';
  import PaperStrip from './lib/PaperStrip.svelte';
  import ExportPanel from './lib/ExportPanel.svelte';
  import Results from './lib/Results.svelte';
  import { MAX_PAPERS, loadFile } from './lib/desk.js';
  import { planExport, exportImages } from './lib/exporter.js';

  let engine = $state(null);
  let papers = $state([]);
  let canUndo = $state(false);
  let version = $state(0);

  let mode = $state('tear');
  let border = $state(true);
  let exporting = $state(false);
  let unit = $state('piece');
  let background = $state('none');
  let results = $state(null);
  let notice = $state('');

  function sync() {
    papers = engine.papers.map((p) => ({ id: p.id, thumb: p.thumb }));
    canUndo = engine.canUndo;
    version++;
  }

  function say(text) {
    notice = text;
    setTimeout(() => { if (notice === text) notice = ''; }, 3500);
  }

  async function addFiles(list) {
    const files = [...(list || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const room = MAX_PAPERS - engine.papers.length;
    if (room <= 0) { say(`紙は${MAX_PAPERS}枚まで置けます。どれかを削除してから追加してください。`); return; }
    const canvases = (await Promise.all(files.slice(0, room).map((f) => loadFile(f, border)))).filter(Boolean);
    if (!canvases.length) { say('画像を読み込めませんでした。JPEG か PNG で試してください。'); return; }
    engine.add(canvases);
    if (files.length > room) say(`紙は${MAX_PAPERS}枚まで置けるので、${room}枚だけ追加しました。`);
  }

  const jobCount = $derived.by(() => {
    version;
    return engine && exporting ? planExport(engine, unit).length : 0;
  });

  async function runExport() {
    results = await exportImages(engine, { unit, background });
  }
  function closeResults() {
    for (const im of results || []) URL.revokeObjectURL(im.url);
    results = null;
  }

  const hint = $derived(
    notice ||
      (mode === 'erase'
        ? '消したいピースをタップすると、そのピースが消えます。間違えたら「元に戻す」で戻せます。'
        : '紙の上をなぞると、その線に沿って破れます。重なったピースや隣の紙もまとめて破れます。')
  );

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); engine?.undo(); }
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
    <label class="check"><input type="checkbox" id="border" bind:checked={border} />白フチ</label>
    <button class="btn" id="undo" disabled={!canUndo} onclick={() => engine.undo()}>元に戻す</button>
    <button class="btn" class:on={exporting} aria-pressed={exporting} onclick={() => (exporting = !exporting)}>画像にする</button>
  </div>
</header>

<PaperStrip {papers} max={MAX_PAPERS} onadd={addFiles} onremove={(id) => engine.remove(id)} />

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
