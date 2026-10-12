export interface IClock {
  now(): number;
}

export const systemClock: IClock = { now: () => Date.now() };
