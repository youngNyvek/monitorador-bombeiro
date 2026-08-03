import { clampRegion } from '../services/region';
import type { RegionRect } from '../types';

interface RegionEditorOptions {
  overlay: HTMLElement;
  box: HTMLElement;
  handle: HTMLElement;
  getRegion: () => RegionRect;
  onChange: (region: RegionRect) => void;
}

type Interaction = {
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  startRegion: RegionRect;
};

export function setupRegionEditor(options: RegionEditorOptions): () => void {
  let activeInteraction: Interaction | null = null;

  const handlePointerMove = (event: PointerEvent): void => {
    if (!activeInteraction) {
      return;
    }

    const bounds = options.overlay.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return;
    }

    const deltaX = ((event.clientX - activeInteraction.startX) / bounds.width) * 100;
    const deltaY = ((event.clientY - activeInteraction.startY) / bounds.height) * 100;

    if (activeInteraction.kind === 'move') {
      const nextRegion = clampRegion({
        ...activeInteraction.startRegion,
        x: activeInteraction.startRegion.x + deltaX,
        y: activeInteraction.startRegion.y + deltaY,
      });
      options.onChange(nextRegion);
      renderRegionBox(options.box, nextRegion);
      return;
    }

    const nextRegion = clampRegion({
      x: activeInteraction.startRegion.x,
      y: activeInteraction.startRegion.y,
      width: activeInteraction.startRegion.width + deltaX,
      height: activeInteraction.startRegion.height + deltaY,
    });
    options.onChange(nextRegion);
    renderRegionBox(options.box, nextRegion);
  };

  const handlePointerUp = (): void => {
    activeInteraction = null;
    document.body.classList.remove('region-interacting');
  };

  const startMove = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    activeInteraction = {
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startRegion: { ...options.getRegion() },
    };
    document.body.classList.add('region-interacting');
  };

  const startResize = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activeInteraction = {
      kind: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      startRegion: { ...options.getRegion() },
    };
    document.body.classList.add('region-interacting');
  };

  options.box.addEventListener('pointerdown', startMove);
  options.handle.addEventListener('pointerdown', startResize);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);

  return () => {
    options.box.removeEventListener('pointerdown', startMove);
    options.handle.removeEventListener('pointerdown', startResize);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  };
}

export function renderRegionBox(box: HTMLElement, region: RegionRect): void {
  box.style.left = `${region.x}%`;
  box.style.top = `${region.y}%`;
  box.style.width = `${region.width}%`;
  box.style.height = `${region.height}%`;
}
