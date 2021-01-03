/**
 * returns a promise that will be resolved after the given ms.
 */
export const waitFor = async (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))
