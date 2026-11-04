<script>
  import { saveFile, makeZip } from './save.js';

  let { images = [], onclose } = $props();
  let status = $state('');
  let busy = $state(false);

  async function run(job) {
    if (busy) return;
    busy = true; status = '';
    try {
      const ok = await job();
      status = ok ? '保存しました。' : '保存をやめました。';
    } catch (e) {
      status = e?.code === 'rate_limited' ? '保存の確認が開いています。閉じてからもう一度押してください。'
        : e?.code === 'unavailable' || e?.code === 'not_granted' ? 'この画面では保存できません。Claude のアプリかブラウザで開き直してください。'
        : '保存できませんでした。もう一度試してください。';
    } finally { busy = false; }
  }
  const saveOne = (im) => run(() => saveFile(im.name, im.blob));
  const saveAll = () => run(async () => {
    const zip = await makeZip(images);
    return saveFile(images[0].name.replace(/_(piece|photo)-[^_]*\.png$/, '') + '.zip', zip);
  });
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="書き出した画像">
  <div class="sheet">
    <div class="panel-head">
      <h2>書き出した画像 <span class="muted">{images.length} 枚</span></h2>
      <button class="icon" aria-label="閉じる" onclick={() => onclose?.()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
      </button>
    </div>
    <div class="sheet-bar">
      <p class="note">{status || '「保存」を押すと、下に表示している名前で保存されます。'}</p>
      {#if images.length > 1}
        <button class="btn primary" disabled={busy} onclick={saveAll}>まとめて保存（ZIP）</button>
      {/if}
    </div>
    <div class="grid" class:single={images.length === 1}>
      {#each images as im (im.name)}
        <figure>
          <div class="checker"><img src={im.url} alt={im.name} /></div>
          <figcaption>
            <span class="fname" title={im.name}>{im.name}</span>
            <span class="row">
              <span class="dim">{im.w} × {im.h}</span>
              <button class="btn small" disabled={busy} onclick={() => saveOne(im)}>保存</button>
            </span>
          </figcaption>
        </figure>
      {/each}
    </div>
  </div>
</div>
