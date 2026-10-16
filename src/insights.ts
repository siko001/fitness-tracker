import { dateSchema, daysEnding, entryMacros, shiftDate, sumMacros, zero, type Activity, type Entry, type Macros, type State } from './model';

export type ReportRange = { start: string; end: string };
export type RangePreset = 'week' | '7' | '14' | '28' | 'month' | 'custom';
export const dayCount = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string, month = today.slice(0, 7)): ReportRange {
  const yesterday = shiftDate(today, -1);
  if (preset === 'month') {
    const start = `${month}-01`;
    if (!dateSchema.safeParse(start).success) return { start: '', end: '' };
    const nextMonth = shiftDate(start, 32).slice(0, 7) + '-01';
    const end = shiftDate(nextMonth, -1);
    return { start, end: end < today ? end : yesterday };
  }
  if (preset === 'week') {
    const weekday = new Date(today + 'T12:00:00').getDay();
    return { start: shiftDate(today, -((weekday + 6) % 7)), end: yesterday };
  }
  return { start: shiftDate(yesterday, 1 - Number(preset)), end: yesterday };
}

export function rangeError(range: ReportRange, today: string): string | null {
  if (!dateSchema.safeParse(range.start).success || !dateSchema.safeParse(range.end).success) return 'Choose a start and end date.';
  if (range.start > range.end) return 'The end date must be on or after the start date.';
  if (range.end > today) return 'Choose dates up to today.';
  if (dayCount(range.start, range.end) > 366) return 'Choose a range of up to 366 days.';
  return null;
}

export type ReportDay = {
  date: string; totals: Macros; entries: Entry[]; checked: boolean; activity?: Activity;
};
export type Tone = 'positive' | 'attention' | 'neutral';
export type Insight = { title: string; detail: string; tone: Tone };
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const hasSteps = (day: ReportDay) => day.activity?.steps != null;
const enough = (count: number, total: number) => count >= 3 && count / total >= .7;

function summarise(days: ReportDay[], state: State) {
  const food = days.filter(d => d.entries.length), checked = food.filter(d => d.checked), steps = days.filter(hasSteps);
  const entries = food.flatMap(d => d.entries), totals = sumMacros(food.map(d => d.totals));
  const checkedTotals = sumMacros(checked.map(d => d.totals));
  const average = food.length ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / food.length])) as Macros : null;
  const checkedAverage = checked.length ? Object.fromEntries(Object.entries(checkedTotals).map(([k, v]) => [k, v / checked.length])) as Macros : null;
  const goal = state.profile.calorieGoal, stepGoal = state.profile.stepGoal;
  const paired = checked.filter(hasSteps);
  const contributors = new Map<string, { name: string; kcal: number; fat: number; count: number }>();
  for (const e of entries) {
    // Snapshot names/preparations keep unrelated foods separate, even if a library item was edited later.
    const key = `${e.name.toLocaleLowerCase()}|${e.preparation.toLocaleLowerCase()}`;
    const value = contributors.get(key) ?? { name: e.name, kcal: 0, fat: 0, count: 0 };
    const macros = entryMacros(e); value.kcal += macros.kcal; value.fat += macros.fat; value.count++;
    contributors.set(key, value);
  }
  const calorieDays = {
    above: goal ? checked.filter(d => d.totals.kcal > goal * 1.1).length : 0,
    near: goal ? checked.filter(d => d.totals.kcal >= goal * .9 && d.totals.kcal <= goal * 1.1).length : 0,
    below: goal ? checked.filter(d => d.totals.kcal < goal * .9).length : 0,
  };
  return {
    days, foodDays: food.length, checkedDays: checked.length, stepDays: steps.length, pairedDays: paired.length,
    totals, average, checkedAverage, calorieDays,
    steps: mean(steps.map(d => d.activity!.steps!)),
    stepGoalDays: stepGoal ? steps.filter(d => d.activity!.steps! >= stepGoal).length : 0,
    activeKcal: mean(days.flatMap(d => d.activity?.activeKcal != null ? [d.activity.activeKcal] : [])),
    activeDays: days.filter(d => d.activity?.activeKcal != null).length,
    distance: mean(days.flatMap(d => d.activity?.distanceKm != null ? [d.activity.distanceKm] : [])),
    distanceDays: days.filter(d => d.activity?.distanceKm != null).length,
    fatShare: totals.kcal > 0 ? totals.fat * 9 / totals.kcal * 100 : null,
    checkedFatShare: checkedTotals.kcal > 0 ? checkedTotals.fat * 9 / checkedTotals.kcal * 100 : null,
    inconsistentNutrition: entries.some(e => e.per100.fat * 9 > e.per100.kcal * 1.05),
    estimatedEntries: entries.filter(e => e.estimated).length, entryCount: entries.length,
    timedEntries: entries.filter(e => e.time).length,
    drinkEntries: entries.filter(e => e.meal === 'Drinks').length,
    drinkKcal: entries.filter(e => e.meal === 'Drinks').reduce((n, e) => n + entryMacros(e).kcal, 0),
    fibreMissing: entries.some(e => e.fibreMissing),
    snackEntries: entries.filter(e => e.meal === 'Snacks').length,
    snackShare: totals.kcal ? entries.filter(e => e.meal === 'Snacks').reduce((n, e) => n + entryMacros(e).kcal, 0) / totals.kcal * 100 : null,
    mealTimes: (['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks'] as const).map(meal => {
      const times = entries.filter(e => e.meal === meal && e.time).map(e => e.time!);
      return { meal, first: times.toSorted()[0] ?? null, last: times.toSorted().at(-1) ?? null, count: times.length };
    }),
    higherFoodLowerSteps: goal && stepGoal ? paired.filter(d => d.totals.kcal > goal * 1.1 && d.activity!.steps! < stepGoal).length : 0,
    foodConfidence: enough(checked.length, days.length), stepConfidence: enough(steps.length, days.length),
    contributors: [...contributors.values()].sort((a, b) => b.kcal - a.kcal),
  };
}
export type PeriodSummary = ReturnType<typeof summarise>;

/** All assessments use finished local days. Today's entries remain visible only in the detail table. */
export function buildReport(state: State, range: ReportRange, today: string) {
  const error = rangeError(range, today);
  if (error) throw new Error(error);
  const end = range.end < today ? range.end : shiftDate(today, -1);
  const count = Math.max(0, dayCount(range.start, end));
  const previousRange = { start: shiftDate(range.start, -count), end: shiftDate(range.start, -1) };
  const index = new Map<string, ReportDay>();
  const meals = new Map<string, Set<string>>();
  for (const date of daysEnding(range.end, dayCount(previousRange.start, range.end))) {
    index.set(date, { date, totals: { ...zero }, entries: [], checked: false }); meals.set(date, new Set());
  }
  for (const entry of state.entries) {
    const day = index.get(entry.date); if (!day) continue;
    day.entries.push(entry); day.totals = sumMacros([day.totals, entryMacros(entry)]); meals.get(entry.date)!.add(entry.meal);
  }
  for (const skip of state.skippedMeals) meals.get(skip.date)?.add(skip.meal);
  for (const activity of state.activities) {
    const day = index.get(activity.date);
    if (day && (!day.activity || activity.source === 'manual')) day.activity = activity;
  }
  for (const day of index.values()) day.checked = ['Breakfast', 'Lunch', 'Dinner'].every(m => meals.get(day.date)!.has(m));
  const daily = daysEnding(range.end, dayCount(range.start, range.end)).map(d => index.get(d)!);
  const current = summarise(daily.filter(d => d.date < today), state);
  const previous = summarise(daysEnding(previousRange.end, count).map(d => index.get(d)!), state);
  const weights = state.weights.filter(w => w.date >= range.start && w.date <= end).toSorted((a, b) => a.date.localeCompare(b.date));
  const weightChange = weights.length >= 2 ? weights.at(-1)!.kg - weights[0].kg : null;
  return { range, previousRange, current, previous, daily, weights, weightChange, verdict: reportVerdict(current, state) };
}

export function reportVerdict(s: PeriodSummary, state: State): Insight {
  if (!s.days.length) return { title: 'Today is still in progress', detail: 'Choose some finished days to see a review.', tone: 'neutral' };
  if (!s.foodConfidence || !s.stepConfidence) return { title: 'More logs, a clearer picture', detail: 'There isn’t enough food and activity coverage to judge this whole period. The recorded trends are below.', tone: 'neutral' };
  if (!state.profile.calorieGoal || !state.profile.stepGoal) return { title: 'Your trends are ready', detail: 'Set calorie and step targets in Settings to see how this period compares with your plan.', tone: 'neutral' };
  const issues: string[] = [];
  if (s.checkedAverage!.kcal > state.profile.calorieGoal * 1.1) issues.push('Food intake averaged above your target.');
  if (s.checkedAverage!.kcal < state.profile.calorieGoal * .9) issues.push('Food intake averaged below your target; check for missing portions.');
  if (s.steps! < state.profile.stepGoal) issues.push('Walking averaged below your step target.');
  if (s.fibreMissing) issues.push('Some labels have no fibre value, so fibre cannot be assessed.');
  if (s.inconsistentNutrition) issues.push('Some food nutrition needs checking.');
  else if (s.checkedFatShare != null && s.checkedFatShare > 30) issues.push('Fat’s share of calories was above the general reference.');
  else if (s.checkedFatShare != null && s.checkedFatShare < 15) issues.push('Fat’s share of calories was below the general reference.');
  if (!s.fibreMissing && s.checkedAverage!.fibre < 25) issues.push('Recorded fibre was below the general reference.');
  return issues.length ? { title: 'A few things to adjust', detail: issues.slice(0, 3).join(' '), tone: 'attention' }
    : { title: 'Tracking well against your targets', detail: 'Average intake was near your calorie target and steps met your goal. Your recorded fat and fibre also fit the general references.', tone: 'positive' };
}

export function nutritionInsights(s: PeriodSummary, state: State): Insight[] {
  const goal = state.profile.calorieGoal;
  const insights: Insight[] = [];
  if (!s.foodConfidence) insights.push({ title: 'Finish your meal check-ins', detail: 'Log or skip each main meal, and include snacks, oils and drinks. Partial days can make intake look lower than it was.', tone: 'neutral' });
  if (s.foodConfidence && goal && s.checkedAverage!.kcal > goal * 1.1) insights.push({ title: 'Review portions first', detail: 'Intake is above your chosen target. The food contributors below show where most logged calories came from.', tone: 'attention' });
  if (s.foodConfidence && goal && s.checkedAverage!.kcal < goal * .9) insights.push({ title: 'Check the lower intake', detail: 'Your checked-in days average below your chosen target. Confirm the diary is complete before treating this as a sustained pattern.', tone: 'attention' });
  if (s.inconsistentNutrition) insights.push({ title: 'Check food nutrition', detail: 'At least one item has more energy from fat than its stated calories allow. Review its portion and nutrition before relying on the fat comparison.', tone: 'attention' });
  else if (s.foodConfidence && s.checkedFatShare != null && s.checkedFatShare > 30) insights.push({ title: 'Look at the type of fat, too', detail: 'Check portions of oils, sauces and other fat contributors. Total fat alone cannot tell us saturated fat or overall food quality.', tone: 'attention' });
  else if (s.foodConfidence && s.checkedFatShare != null && s.checkedFatShare < 15) insights.push({ title: 'Review the low fat share', detail: 'Check food records and missing oils or sauces. Fat is essential; a lower percentage is not automatically better.', tone: 'attention' });
  if (s.foodConfidence && !s.fibreMissing && s.checkedAverage!.fibre < 25) insights.push({ title: 'Make room for fibre', detail: 'Recorded fibre is low against the general reference. Check incomplete nutrition labels; beans, vegetables and whole grains can help.', tone: 'attention' });
  if (s.stepConfidence && state.profile.stepGoal && s.steps! < state.profile.stepGoal) insights.push({ title: 'Build a steadier walking routine', detail: 'Short walks that fit your day can help you work toward your step goal. Walking is not a requirement to earn or cancel out food.', tone: 'attention' });
  if (!s.stepConfidence) insights.push({ title: 'Fill the activity gaps', detail: 'Check watch sync or enter daily totals. Days without step data are excluded, not counted as zero.', tone: 'neutral' });
  if (s.fibreMissing) insights.push({ title: 'Fibre data is incomplete', detail: 'Some labels have no fibre value. Your review leaves fibre unknown instead of treating it as zero.', tone: 'neutral' });
  if (!insights.length) insights.push({ title: 'Keep the routine sustainable', detail: 'Your averages look consistent with your plan. Keep logging and look at weight over several weeks rather than reacting to a single day.', tone: 'positive' });
  return insights.slice(0, 4);
}
