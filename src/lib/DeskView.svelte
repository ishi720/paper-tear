<script>
  import { onMount } from 'svelte';
  import { Desk } from './desk.js';

  /** mode: 'tear' (drag to tear) | 'erase' (tap a piece to remove it) */
  let { engine = $bindable(null), mode = 'tear', empty = false, onchange, onfiles } = $props();

  let canvas, wrap;
  let dropping = $state(false);
  let stroke = null, down = null;

  onMount(() => {
    const d = new Desk(canvas, () => onchange?.());
    engine = d;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      d.measure(r.width, r.height);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (engine && mode !== 'erase' && engine.overlay.hover !== null) { engine.overlay.hover = null; engine.draw(); }
  });

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  const world = (xy) => engine.screenToWorld(xy[0], xy[1]);

  function setHover(id) {
    if (engine.overlay.hover === id) return;
    engine.overlay.hover = id; engine.draw();
  }

  function onDown(e) {
    if (!engine) return;
    canvas.setPointerCapture(e.pointerId);
    const xy = point(e);
    down = xy;
    if (mode === 'tear') { stroke = [world(xy)]; engine.overlay.stroke = stroke; engine.draw(); }
    else setHover(engine.pieceAt(world(xy))?.id ?? null);
  }
  function onMove(e) {
    if (!engine) return;
    const xy = point(e);
    if (mode === 'erase') {
      if (!down || e.pointerType === 'mouse') setHover(engine.pieceAt(world(xy))?.id ?? null);
      return;
    }
    if (!stroke) return;
    const w = world(xy), l = stroke[stroke.length - 1];
    if (Math.hypot(w[0] - l[0], w[1] - l[1]) * engine.view.s > 3) { stroke.push(w); engine.draw(); }
  }
  function onUp(e) {
    if (!engine || !down) return;
    const xy = point(e), moved = Math.hypot(xy[0] - down[0], xy[1] - down[1]);
    down = null;
    if (mode === 'tear' && stroke) {
      const s = stroke; stroke = null; engine.overlay.stroke = null;
      engine.tear(s); engine.draw();
    } else if (mode === 'erase') {
      const p = moved < 10 ? engine.pieceAt(world(xy)) : null;
      if (p) engine.removePiece(p.id);
      if (e.pointerType !== 'mouse') setHover(null);
    }
  }
  function onCancel() {
    down = null;
    if (stroke) { stroke = null; engine.overlay.stroke = null; engine.draw(); }
    if (engine) setHover(null);
  }
</script>

<div
  class="stage"
  class:drop={dropping}
  bind:this={wrap}
  role="presentation"
  ondragover={(e) => { e.preventDefault(); dropping = true; }}
  ondragleave={() => (dropping = false)}
  ondrop={(e) => { e.preventDefault(); dropping = false; onfiles?.(e.dataTransfer.files); }}
>
  <canvas
    bind:this={canvas}
    class:erase={mode === 'erase'}
    aria-label={mode === 'erase' ? '紙を置いた机。ピースをタップすると消えます' : '紙を置いた机。なぞると破れます'}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onCancel}
    onpointerleave={(e) => { if (e.pointerType === 'mouse' && !down && engine) setHover(null); }}
  ></canvas>
  {#if empty}
    <p class="empty">紙がありません。<br />「＋ 追加」から紙を入れるか、ここにドロップしてください。</p>
  {/if}
</div>
