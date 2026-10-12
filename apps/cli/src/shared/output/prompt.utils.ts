import { createInterface } from "node:readline/promises";

/** Asks one question on the terminal and returns the trimmed answer. */
export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
