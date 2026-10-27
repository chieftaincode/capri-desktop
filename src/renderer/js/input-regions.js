// Native input regions contain only the character silhouette and visible controls.
// Mouse position never enables the entire transparent overlay on Linux.
export function inputRegions({ capri, panel, chip, width, height }) {
  const regions = [];
  const add = (rect) => {
    if (!rect) return;
    const x = Math.max(0, Math.floor(rect.left)), y = Math.max(0, Math.floor(rect.top));
    const right = Math.min(width, Math.ceil(rect.right)), bottom = Math.min(height, Math.ceil(rect.bottom));
    if (right > x && bottom > y) regions.push([x, y, right - x, bottom - y]);
  };
  if (!capri.hidden && capri.p.alpha >= 0.5) {
    const b = capri.canvas.getBoundingClientRect();
    const step = 4;
    for (let y = Math.max(0, Math.floor(b.top)); y < Math.min(height, b.bottom); y += step) {
      let start = null;
      const left = Math.max(0, Math.floor(b.left)), right = Math.min(width, Math.ceil(b.right));
      for (let x = left; x < right; x += step) {
        const hit = capri.hit(x + step / 2, y + step / 2);
        if (hit && start === null) start = x;
        if (!hit && start !== null) { regions.push([start, y, x - start, step]); start = null; }
      }
      if (start !== null) regions.push([start, y, right - start, step]);
    }
  }
  add(panel.rect());
  if (chip.visible) add(chip.canvas.getBoundingClientRect());
  return regions;
}
