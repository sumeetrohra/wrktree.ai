/** Milliseconds since epoch. The protocol carries time only in this form. */
export const now = (): number => Date.now();

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
