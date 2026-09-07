import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BlenderAdapter } from '../blenderAdapter';
import { renderMultiView, STANDARD_8_VIEWS } from '../visualVerifier';

let adapter: BlenderAdapter;

beforeAll(async () => {
  adapter = new BlenderAdapter();
  await adapter.init();
  await adapter.createMesh('cube', { size: 2 });
}, 30000);

afterAll(async () => {
  await adapter.dispose();
});

describe('visualVerifier', () => {
  it('renders 8 standard views', async () => {
    const result = await renderMultiView(adapter, { width: 400, height: 300 });
    expect(result.views).toHaveLength(8);
    expect(result.totalSizeBytes).toBeGreaterThan(10000);

    for (const view of result.views) {
      expect(view.name).toBeTruthy();
      expect(view.render.imagePath).toBeTruthy();
      expect(view.render.width).toBe(400);
      expect(view.render.height).toBe(300);
    }
  }, 60000);

  it('renders custom views', async () => {
    const customViews = STANDARD_8_VIEWS.slice(0, 3);
    const result = await renderMultiView(adapter, {
      width: 200,
      height: 150,
      views: customViews,
    });
    expect(result.views).toHaveLength(3);
  }, 30000);
});
