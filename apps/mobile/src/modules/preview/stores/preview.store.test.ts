import { frameUrl, previewId, usePreviewStore } from "./preview.store";

describe("preview store", () => {
  const id = previewId("h1", "wt_1");

  it("loads the one-time key once, then the bare URL", () => {
    const s = usePreviewStore.getState();
    s.opened(id, "https://tok.preview.example/", "secret");
    const first = usePreviewStore.getState().open[id];
    expect(first && frameUrl(first)).toBe("https://tok.preview.example/?k=secret");
    s.loaded(id);
    s.reload(id);
    const later = usePreviewStore.getState().open[id];
    expect(later && frameUrl(later)).toBe("https://tok.preview.example/");
    expect(later?.loads).toBe(1);
  });

  it("keeps the chosen width across a restart and forgets a stopped preview", () => {
    const s = usePreviewStore.getState();
    s.opened(id, "http://localhost:41000/", null);
    s.setWidth(id, "phone");
    s.opened(id, "http://localhost:41000/", null);
    expect(usePreviewStore.getState().open[id]?.width).toBe("phone");
    s.closed(id);
    expect(usePreviewStore.getState().open[id]).toBeUndefined();
  });
});
