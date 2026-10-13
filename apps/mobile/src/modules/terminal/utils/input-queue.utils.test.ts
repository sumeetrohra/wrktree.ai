import { InputQueue } from "./input-queue.utils";

describe("InputQueue", () => {
  it("sends in order, batching what is typed while a send is in flight", async () => {
    const sent: string[] = [];
    let release = (): void => undefined;
    const q = new InputQueue(
      (d) =>
        new Promise<void>((resolve) => {
          sent.push(d);
          release = resolve;
        }),
    );
    q.push("e");
    for (const c of "cho hi\r") q.push(c);
    expect(sent).toEqual(["e"]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual(["e", "cho hi\r"]);
    release();
  });

  it("keeps going after a failed send", async () => {
    const errors: unknown[] = [];
    const sent: string[] = [];
    const q = new InputQueue(
      (d) => {
        sent.push(d);
        return d === "a" ? Promise.reject(new Error("offline")) : Promise.resolve();
      },
      (e) => errors.push(e),
    );
    q.push("a");
    q.push("b");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(["a", "b"]);
    expect(errors).toHaveLength(1);
  });
});
