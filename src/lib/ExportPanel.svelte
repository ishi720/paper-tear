<script>
  let {
    unit = $bindable('piece'),
    background = $bindable('none'),
    count = 0,
    onexport,
    onclose,
  } = $props();

  const units = [
    ['piece', 'ピースごと', '破ったピースを1枚ずつ、それぞれの形で切り抜きます。'],
    ['paper', '紙ごと', '同じ紙から出たピースを、今の並びのまま1枚にまとめます。'],
    ['desk', '机全体', '机の上のピースを、見た目のまま1枚にします。'],
  ];
  const backgrounds = [['none', '透明'], ['white', '白'], ['desk', '机の色']];
  const unitNote = $derived(units.find((u) => u[0] === unit)[2]);
</script>

<aside class="panel" aria-label="画像にする">
  <div class="panel-head">
    <h2>画像にする</h2>
    <button class="icon" aria-label="閉じる" onclick={() => onclose?.()}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
    </button>
  </div>

  <fieldset>
    <legend>単位</legend>
    <div class="seg wide">
      {#each units as [v, label]}
        <button aria-pressed={unit === v} onclick={() => (unit = v)}>{label}</button>
      {/each}
    </div>
    <p class="note">{unitNote}</p>
  </fieldset>

  <fieldset>
    <legend>背景</legend>
    <div class="seg">
      {#each backgrounds as [v, label]}
        <button aria-pressed={background === v} onclick={() => (background = v)}>{label}</button>
      {/each}
    </div>
  </fieldset>

  <div class="panel-foot">
    <span class="out"><b>{count}</b> 枚の画像</span>
    <button class="btn primary" disabled={!count} onclick={() => onexport?.()}>書き出す</button>
  </div>
</aside>
