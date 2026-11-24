import { describe, it, expect } from 'vitest';
import {
  type SchedulerJob,
  type SchedulerPrinter,
  describeSchedule,
  scheduleFarm,
} from '../farmScheduler';

const NOW = '2026-11-24T08:00:00.000Z';
const MIN = 60_000;

function printer(overrides: Partial<SchedulerPrinter> & { id: string }): SchedulerPrinter {
  return {
    name: overrides.id.toUpperCase(),
    status: 'idle',
    technologies: ['fdm'],
    materials: ['PLA', 'PETG'],
    buildVolumeMm: { x: 256, y: 256, z: 256 },
    successRatePct: 90,
    current: null,
    availableAt: null,
    ...overrides,
  };
}

function job(overrides: Partial<SchedulerJob> & { id: string }): SchedulerJob {
  return {
    name: overrides.id,
    material: 'PLA',
    footprintMm: { x: 100, y: 100, z: 100 },
    durationMinutes: 60,
    ...overrides,
  };
}

describe('scheduleFarm — hard constraints', () => {
  it('refuses a job needing a material the machine cannot run, and says why', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', material: 'PA-CF' })],
      [printer({ id: 'p1', materials: ['PLA'] })],
      { now: NOW },
    );

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned[0].reasons).toEqual(['material-unsupported']);
    expect(plan.unassigned[0].blockedBy[0]).toMatchObject({
      printerId: 'p1',
      reasons: ['material-unsupported'],
    });
  });

  it('refuses a part larger than the usable build volume on every axis check', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', footprintMm: { x: 300, y: 100, z: 100 } })],
      [printer({ id: 'p1', buildVolumeMm: { x: 256, y: 256, z: 256 } })],
      { now: NOW },
    );

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned[0].reasons).toEqual(['too-large']);
  });

  it('applies the margin so a brim does not get planned into the last millimetre', () => {
    const snug = job({ id: 'j1', footprintMm: { x: 250, y: 250, z: 250 } });

    // Without a margin it fits a 256³ machine.
    expect(scheduleFarm([snug], [printer({ id: 'p1' })], { now: NOW }).assignments).toHaveLength(1);

    // With a 10 mm margin it does not.
    const tight = scheduleFarm([snug], [printer({ id: 'p1' })], { now: NOW, marginMm: 10 });
    expect(tight.assignments).toHaveLength(0);
    expect(tight.unassigned[0].reasons).toEqual(['too-large']);
  });

  it('does not guess a build volume for a machine that never recorded one', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1' })],
      [printer({ id: 'p1', buildVolumeMm: null })],
      { now: NOW },
    );

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned[0].reasons).toEqual(['build-volume-unknown']);
    expect(plan.notes.join(' ')).toContain('no build volume on record');
  });

  it('will not place a job with an unknown footprint', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', footprintMm: null })],
      [printer({ id: 'p1' })],
      { now: NOW },
    );

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned[0].reasons).toEqual(['unknown-footprint']);
  });

  it('treats an errored printer without a recovery ETA as unplannable, not idle', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1' })],
      [printer({ id: 'p1', status: 'error', availableAt: null })],
      { now: NOW },
    );

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned[0].reasons).toEqual(['no-ready-window']);
  });

  it('plans onto a machine in maintenance once it states when it is back', () => {
    const backAt = '2026-11-24T10:00:00.000Z';
    const plan = scheduleFarm(
      [job({ id: 'j1', durationMinutes: 30 })],
      [printer({ id: 'p1', status: 'maintenance', availableAt: backAt })],
      { now: NOW },
    );

    expect(plan.assignments[0].plannedStartAt).toBe(backAt);
    expect(plan.assignments[0].plannedEndAt).toBe('2026-11-24T10:30:00.000Z');
  });

  it('reports no-printers instead of silently returning an empty plan', () => {
    const plan = scheduleFarm([job({ id: 'j1' })], [], { now: NOW });

    expect(plan.unassigned[0].reasons).toEqual(['no-printers']);
    expect(plan.makespanAt).toBeNull();
  });
});

describe('scheduleFarm — placement', () => {
  it('gives a small part to the small machine so the large one stays open', () => {
    const plan = scheduleFarm(
      [job({ id: 'small', footprintMm: { x: 60, y: 60, z: 60 } })],
      [
        printer({ id: 'big', buildVolumeMm: { x: 400, y: 400, z: 400 } }),
        printer({ id: 'small', buildVolumeMm: { x: 180, y: 180, z: 180 } }),
      ],
      { now: NOW },
    );

    expect(plan.assignments[0].printerId).toBe('small');
    expect(plan.assignments[0].fitRatio).toBeGreaterThan(0);
  });

  it('keeps one machine serial: the second job starts when the first ends', () => {
    const plan = scheduleFarm(
      [job({ id: 'a', durationMinutes: 60 }), job({ id: 'b', durationMinutes: 30 })],
      [printer({ id: 'p1' })],
      { now: NOW },
    );

    const byId = Object.fromEntries(plan.assignments.map((a) => [a.jobId, a]));
    expect(byId.a.plannedStartAt).toBe(NOW);
    expect(byId.b.plannedStartAt).toBe(byId.a.plannedEndAt);
    expect(byId.b.sequence).toBe(2);
    expect(plan.timelines[0].jobIds).toEqual(['a', 'b']);
  });

  it('starts after the job already on the bed, and its ETA is what counts', () => {
    const endsAt = '2026-11-24T09:30:00.000Z';
    const plan = scheduleFarm(
      [job({ id: 'j1' })],
      [
        printer({
          id: 'p1',
          status: 'printing',
          current: { jobId: 'running', material: 'PLA', endsAt },
        }),
      ],
      { now: NOW },
    );

    expect(plan.assignments[0].plannedStartAt).toBe(endsAt);
    // Same material already loaded, so no changeover is charged.
    expect(plan.assignments[0].materialChange).toBe(false);
    expect(plan.assignments[0].changeoverMinutes).toBe(0);
  });

  it('charges a changeover when the loaded material differs, and prices it into start', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', material: 'PETG', durationMinutes: 60 })],
      [
        printer({
          id: 'p1',
          status: 'printing',
          current: { jobId: 'running', material: 'PLA', endsAt: '2026-11-24T09:00:00.000Z' },
        }),
      ],
      { now: NOW, changeoverMinutes: 20 },
    );

    const a = plan.assignments[0];
    expect(a.materialChange).toBe(true);
    expect(a.changeoverMinutes).toBe(20);
    expect(a.plannedStartAt).toBe('2026-11-24T09:20:00.000Z');
    expect(a.plannedEndAt).toBe('2026-11-24T10:20:00.000Z');
  });

  it('prefers the machine that already holds the material when timing ties', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', material: 'PETG', durationMinutes: 60 })],
      [
        printer({ id: 'a-loaded', materials: ['PETG'], current: null }),
        printer({ id: 'b-empty', materials: ['PETG'], current: null }),
      ],
      { now: NOW, changeoverMinutes: 0 },
    );

    // Both machines are material-compatible and free now; the tie falls to id
    // rather than to insertion order.
    expect(plan.assignments[0].printerId).toBe('a-loaded');
  });

  it('sends work to the machine that finishes it soonest, not the one that starts soonest', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', durationMinutes: 60 })],
      [
        // Idle but must swap material (30 min changeover).
        printer({ id: 'needs-swap', materials: ['PLA'], current: { jobId: 'x', material: 'PETG', endsAt: NOW } }),
        // Busy for 10 minutes, but already loaded with PLA.
        printer({
          id: 'warm',
          status: 'printing',
          materials: ['PLA'],
          current: { jobId: 'y', material: 'PLA', endsAt: '2026-11-24T08:10:00.000Z' },
        }),
      ],
      { now: NOW, changeoverMinutes: 30 },
    );

    expect(plan.assignments[0].printerId).toBe('warm');
    expect(plan.assignments[0].plannedStartAt).toBe('2026-11-24T08:10:00.000Z');
  });

  it('runs higher priority first when machines are scarce', () => {
    const plan = scheduleFarm(
      [
        job({ id: 'low', priority: 1 }),
        job({ id: 'high', priority: 9 }),
      ],
      [printer({ id: 'p1' })],
      { now: NOW },
    );

    expect(plan.assignments[0].jobId).toBe('high');
    expect(plan.assignments[0].sequence).toBe(1);
    expect(plan.assignments[1].jobId).toBe('low');
  });

  it('refuses a job with a zero duration instead of booking an empty slot', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', durationMinutes: 0 })],
      [printer({ id: 'p1' })],
      { now: NOW },
    );

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned[0].reasons).toEqual(['invalid-duration']);
  });
});

describe('scheduleFarm — due dates', () => {
  it('still plans a job that cannot meet its due date, but flags it as late', () => {
    const dueAt = '2026-11-24T08:30:00.000Z';
    const plan = scheduleFarm(
      [job({ id: 'j1', durationMinutes: 120, dueAt })],
      [printer({ id: 'p1' })],
      { now: NOW },
    );

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].lateMinutes).toBe(90);
    expect(plan.lateJobIds).toEqual(['j1']);
    expect(describeSchedule(plan)).toContain('1 late');
  });

  it('does not invent a late flag for a job without a due date', () => {
    const plan = scheduleFarm([job({ id: 'j1' })], [printer({ id: 'p1' })], { now: NOW });

    expect(plan.assignments[0].lateMinutes).toBe(0);
    expect(plan.lateJobIds).toEqual([]);
  });
});

describe('scheduleFarm — determinism and reporting', () => {
  it('produces an identical plan for identical input, regardless of job input order', () => {
    const printers = [printer({ id: 'p2' }), printer({ id: 'p1', successRatePct: 90 })];
    const jobs = [
      job({ id: 'j2', footprintMm: { x: 90, y: 90, z: 90 } }),
      job({ id: 'j1', footprintMm: { x: 90, y: 90, z: 90 } }),
      job({ id: 'j3', footprintMm: null }),
    ];

    const first = scheduleFarm(jobs, printers, { now: NOW });
    const second = scheduleFarm([...jobs].reverse(), printers, { now: NOW });

    expect(second.assignments).toEqual(first.assignments);
    expect(second.unassigned.map((u) => u.jobId)).toEqual(first.unassigned.map((u) => u.jobId));
  });

  it('makes the makespan the latest planned end and keeps busy minutes per machine', () => {
    const plan = scheduleFarm(
      [job({ id: 'a', durationMinutes: 60 }), job({ id: 'b', durationMinutes: 90 })],
      [printer({ id: 'p1' }), printer({ id: 'p2' })],
      { now: NOW },
    );

    expect(plan.makespanAt).toBe('2026-11-24T09:30:00.000Z');
    const busy = plan.timelines.reduce((sum, t) => sum + t.busyMinutes, 0);
    expect(busy).toBe(150);
    expect(describeSchedule(plan)).toContain('2/2 job(s) placed across 2 machine(s)');
  });

  it('keeps blocked reasons per machine so the missing fact is obvious', () => {
    const plan = scheduleFarm(
      [job({ id: 'j1', material: 'PA-CF' })],
      [printer({ id: 'p1', materials: ['PLA'] }), printer({ id: 'p2', materials: ['PA-CF'], buildVolumeMm: null })],
      { now: NOW },
    );

    expect(plan.unassigned[0].reasons).toEqual(['build-volume-unknown', 'material-unsupported']);
    const byMachine = Object.fromEntries(plan.unassigned[0].blockedBy.map((b) => [b.printerId, b.reasons]));
    expect(byMachine.p1).toEqual(['material-unsupported']);
    expect(byMachine.p2).toEqual(['build-volume-unknown']);
  });

  it('throws on an unparsable now rather than planning against the wall clock', () => {
    expect(() => scheduleFarm([job({ id: 'j1' })], [printer({ id: 'p1' })], { now: 'yesterday' })).toThrow(
      /invalid now/,
    );
  });
});
