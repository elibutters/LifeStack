import "server-only";
import { loadActivities, type Activity } from "./activities";
import { todayInTz } from "./dates";
import { overviewOf, type Workout } from "./workouts-core";

const MAX = 5000;

const toWorkout = (a: Activity): Workout => ({
  id: a.id,
  date: (a.startLocal ?? a.start).slice(0, 10), // the day on the athlete's own clock
  start: a.start,
  sport: a.sport,
  name: a.name,
  distanceM: a.distanceM ?? 0,
  movingS: a.movingS ?? 0,
  elapsedS: a.elapsedS,
  elevationM: a.elevationM ?? 0,
  avgHr: a.avgHr,
  calories: a.calories,
  effort: a.effort,
});

export const loadWorkouts = async (): Promise<Workout[]> => (await loadActivities({ limit: MAX })).map(toWorkout);

export async function workoutsOverview(weeks: number, recent: number) {
  return overviewOf(await loadWorkouts(), todayInTz(), weeks, recent);
}
