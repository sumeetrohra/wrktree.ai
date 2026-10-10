import type { Harness } from "./harness.ts";

export type Scenario = {
  /** Order in the suite and in the video. */
  n: number;
  title: string;
  /** One line under the title card: what this proves. */
  summary: string;
  /** The tech-spec acceptance criteria this scenario covers. */
  covers: string[];
  run(h: Harness): Promise<void>;
};
