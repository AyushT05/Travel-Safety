import { describe, expect, test } from 'vitest';
import { MAX_CLUSTER_ZOOM, clusterDevices, project } from '../src/lib/risk/cluster';

const item = (id, lat, lon, level = 'none') => ({ id, lat, lon, level });

describe('project', () => {
  test('the equator and prime meridian are the centre of the world tile grid', () => {
    const [x, y] = project(0, 0, 3);
    expect(x).toBeCloseTo(1024, 3);
    expect(y).toBeCloseTo(1024, 3);
  });
  test('latitude grows upward, longitude to the right', () => {
    expect(project(12.3, 76.65, 10)[0]).toBeGreaterThan(project(12.3, 70, 10)[0]);
    expect(project(20, 76, 10)[1]).toBeLessThan(project(12, 76, 10)[1]);
  });
});

describe('clusterDevices', () => {
  const near = [item('a', 12.3000, 76.6500), item('b', 12.3004, 76.6503), item('c', 12.3002, 76.6498)];
  test('nearby tourists merge when zoomed out and are left individual when zoomed in', () => {
    const c = clusterDevices(near, 11);
    expect(c).toHaveLength(1);
    expect(c[0].count).toBe(3);
    expect(c[0].ids.sort()).toEqual(['a', 'b', 'c']);
    expect(clusterDevices(near, MAX_CLUSTER_ZOOM + 1)).toEqual([]);
  });
  test('a lone tourist is never a cluster, distant ones stay apart', () => {
    expect(clusterDevices([item('a', 12.3, 76.65)], 8)).toEqual([]);
    expect(clusterDevices([item('a', 12.3, 76.65), item('b', 13.9, 77.9)], 8)).toEqual([]);
  });
  test('the bubble shows the worst risk among its members and how many are in a risk zone', () => {
    const c = clusterDevices([item('a', 12.3, 76.65, 'none'), item('b', 12.3002, 76.6502, 'danger'), item('c', 12.3001, 76.6501, 'caution')], 11)[0];
    expect(c.worst).toBe('danger');
    expect(c.inRisk).toBe(2);
  });
  test('the centre is the mean position and bad coordinates are ignored', () => {
    const c = clusterDevices([item('a', 12.30, 76.65), item('b', 12.302, 76.652), item('x', NaN, 76.65)], 11)[0];
    expect(c.count).toBe(2);
    expect(c.lat).toBeCloseTo(12.301, 6);
    expect(c.lon).toBeCloseTo(76.651, 6);
  });
});
