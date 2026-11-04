<script>
  let { photos = [], max = 12, onadd, onremove } = $props();
  const full = $derived(photos.length >= max);
</script>

<div class="strip" aria-label="机の上の写真">
  {#each photos as ph, i (ph.id)}
    <div class="thumb">
      <img src={ph.thumb} alt="写真 {i + 1}" />
      <span class="num">{i + 1}</span>
      <button class="del" aria-label="写真 {i + 1} を削除" title="この写真を削除" onclick={() => onremove?.(ph.id)}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
      </button>
    </div>
  {/each}
  <label class="add" class:disabled={full} for="addFile" title={full ? `写真は${max}枚まで置けます` : '写真を追加'}>
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
  <span class="cap">{photos.length} / {max}</span>
</div>
