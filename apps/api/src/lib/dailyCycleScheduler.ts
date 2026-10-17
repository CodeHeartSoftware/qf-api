import { startDailyCycleJob } from './dailyCycle.js';
import { isDetachedJobRunning } from './detachedJobs.js';
import { getSettings, updateSettings, type DailyCycleSchedule } from './settingsStore.js';
import { isLocked } from './subprocess.js';

const TICK_MS = 60_000;

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function localTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Whether `schedule` should fire at `now`: enabled, a weekday, at/after its time, and not
 * already fired today. Exchange holidays aren't modelled — a holiday cycle just plays zero
 * rounds, the same as clicking the button would. */
export function isScheduleDue(schedule: DailyCycleSchedule | undefined, now: Date): boolean {
  if (schedule?.enabled !== true || schedule.matchIds.length === 0) return false;
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  if (localTime(now) < schedule.timeLocal) return false;
  return schedule.lastTriggeredDate !== localDate(now);
}

async function tick(rootDir: string): Promise<void> {
  const settings = await getSettings(rootDir);
  const schedule = settings.dailyCycle;
  const now = new Date();
  if (schedule === undefined || !isScheduleDue(schedule, now)) return;

  // Marked BEFORE starting anything, so a crash mid-start can never cause a second firing today.
  await updateSettings(rootDir, { dailyCycle: { ...schedule, lastTriggeredDate: localDate(now) } });
  for (const matchId of schedule.matchIds) {
    const key = `run:${matchId}`;
    if (isLocked(key) || (await isDetachedJobRunning(rootDir, key))) {
      console.log(`scheduler: skipping "${matchId}" — already busy.`);
      continue;
    }
    // Never re-pins on its own: a drifted bot makes the scheduled cycle stop and say so.
    const job = await startDailyCycleJob(rootDir, matchId, { repin: false });
    console.log(`scheduler: started daily cycle for "${matchId}" (job ${job.id}).`);
  }
}

/** Checks once a minute whether the Settings tab's daily-cycle schedule is due. In-process and
 * deliberately simple: it only runs while this API is running — there's no OS-level cron. */
export function startDailyCycleScheduler(rootDir: string): NodeJS.Timeout {
  const timer = setInterval(() => {
    tick(rootDir).catch((error: unknown) => {
      console.error(`scheduler: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, TICK_MS);
  timer.unref();
  return timer;
}
