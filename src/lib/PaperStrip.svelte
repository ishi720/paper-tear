<script>
  let { papers = [], selected = null, max = 12, onadd, onremove, onselect } = $props();
  const full = $derived(papers.length >= max);
</script>

<div class="strip" aria-label="机の上の紙">
  {#each papers as paper, i (paper.id)}
    <div class="thumb">
      <button
        class="pick"
        aria-pressed={paper.id === selected}
        aria-label="紙 {i + 1} を選ぶ"
        title="この紙を「一つ戻す・一つ進める・元に戻す」の対象にする"
        onclick={() => onselect?.(paper.id)}
      >
        <img src={paper.thumb} alt="" />
      </button>
      <span class="num">{i + 1}</span>
      <button class="del" aria-label="紙 {i + 1} を削除" title="この紙を削除" onclick={() => onremove?.(paper.id)}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
      </button>
    </div>
  {/each}
  <label class="add" class:disabled={full} for="addFile" title={full ? `紙は${max}枚まで置けます` : '紙を追加'}>
    <span class="plus" aria-hidden="true">＋</span>
    <span>追加</span>
    <input
      type="file"
      id="addFile"
      accept="image/*"
      multiple
      disabled={full}
      onchange={(e) => { onadd?.(e.currentTarget.files); e.currentTarget.value = ''; }}
    />
  </label>
  <span class="cap">{papers.length} / {max}</span>
</div>
