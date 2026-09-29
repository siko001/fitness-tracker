import { afterEach, describe, expect, it, vi } from 'vitest';

const health = vi.hoisted(() => ({ isAvailable: vi.fn(), requestAuthorization: vi.fn(), checkAuthorization: vi.fn(), queryAggregated: vi.fn(), readWatchSteps: vi.fn() }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => health, Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capgo/capacitor-health', () => ({ Health: health }));
import { syncHealth } from './health';

const originalTimeZone = process.env.TZ;
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); if (originalTimeZone === undefined) delete process.env.TZ; else process.env.TZ = originalTimeZone; });
function allowHealth() {
  process.env.TZ = 'Europe/Malta';
  vi.useFakeTimers();
  health.readWatchSteps.mockResolvedValue({ steps: null });
  health.isAvailable.mockResolvedValue({ available: true });
  const allowed = { readAuthorized: ['steps', 'distance', 'calories'] };
  health.checkAuthorization.mockResolvedValue(allowed);
  health.requestAuthorization.mockResolvedValue(allowed);
}

describe('daily health imports', () => {
  it('uses the native Zepp-only total instead of the combined phone/watch aggregate', async () => {
    allowHealth();
    vi.setSystemTime(new Date('2026-09-29T08:15:00+02:00'));
    health.readWatchSteps.mockImplementation(async ({ date }) => ({ steps: date === '2026-09-29' ? 568 : null }));
    health.queryAggregated.mockImplementation(async ({ dataType }) => ({ samples: dataType === 'steps' ? [{ value: 579 }] : [] }));
    const result = await syncHealth(false, 2);
    expect(result.records.find(record => record.date === '2026-09-29')).toMatchObject({ steps: 568, stepSource: 'zepp' });
    expect(health.queryAggregated.mock.calls.every(([options]) => options.dataType !== 'steps')).toBe(true);
    expect(health.readWatchSteps).toHaveBeenCalledWith({ date: '2026-09-29' });
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
