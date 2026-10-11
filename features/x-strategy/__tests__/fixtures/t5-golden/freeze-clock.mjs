// Test preload: freezes Date.now() so day-view output is deterministic (buildDayPlan defaults `now` to Date.now()).
const FROZEN = Date.parse('2026-10-11T15:00:00.000Z');
Date.now = () => FROZEN;
