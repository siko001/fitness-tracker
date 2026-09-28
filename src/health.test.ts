import { afterEach, describe, expect, it, vi } from 'vitest';

const health = vi.hoisted(() => ({ isAvailable: vi.fn(), requestAuthorization: vi.fn(), checkAuthorization: vi.fn(), queryAggregated: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capgo/capacitor-health', () => ({ Health: health }));
import { syncHealth } from './health';

const originalTimeZone = process.env.TZ;
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); if (originalTimeZone === undefined) delete process.env.TZ; else process.env.TZ = originalTimeZone; });
function allowHealth() {
  process.env.TZ = 'Europe/Malta';
  vi.useFakeTimers();
  health.isAvailable.mockResolvedValue({ available: true });
  const allowed = { readAuthorized: ['steps', 'distance', 'calories'] };
  health.checkAuthorization.mockResolvedValue(allowed);
  health.requestAuthorization.mockResolvedValue(allowed);
}

describe('daily health imports', () => {
  it('counts all measured steps in Zepp’s current interval instead of prorating them away', async () => {
    allowHealth();
    vi.setSystemTime(new Date('2026-09-28T23:54:41+02:00'));
    const dayEnd = new Date('2026-09-29T00:00:00+02:00').getTime();
    health.queryAggregated.mockImplementation(async ({ dataType, startDate, endDate }) => {
      if (dataType !== 'steps' || startDate !== '2026-09-27T22:00:00.000Z') return { samples: [] };
      // Reproduce the phone's actual result: 673 completed steps plus Zepp's
      // 61 measured steps in its 23:50–00:00 interval. A clipped query gives 701.
      const fraction = Math.max(0, Math.min(1, (new Date(endDate).getTime() - (dayEnd - 600000)) / 600000));
      return { samples: [{ value: 673 + Math.floor(61 * fraction) }] };
    });
    const result = await syncHealth(false, 2);
    expect(result.records.find(record => record.date === '2026-09-28')?.steps).toBe(734);
    expect(health.queryAggregated).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-09-27T22:00:00.000Z', endDate: '2026-09-28T22:00:00.000Z' }));
    expect(health.queryAggregated).toHaveBeenCalledTimes(6);
    expect(health.requestAuthorization).not.toHaveBeenCalled();
    expect(health.checkAuthorization).toHaveBeenCalledOnce();
  });

  it('keeps local calendar boundaries on a Malta daylight-saving change', async () => {
    allowHealth();
    vi.setSystemTime(new Date('2026-10-25T14:00:00+01:00'));
    health.queryAggregated.mockResolvedValue({ samples: [] });
    await syncHealth(false, 2);
    expect(health.queryAggregated).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-10-24T22:00:00.000Z', endDate: '2026-10-25T23:00:00.000Z' }));
  });
});
