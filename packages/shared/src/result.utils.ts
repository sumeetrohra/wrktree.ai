export type TResult<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): TResult<T, never> => ({ ok: true, value });
export const err = <E>(error: E): TResult<never, E> => ({ ok: false, error });
