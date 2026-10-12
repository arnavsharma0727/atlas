import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ResearchSweep from "./research-sweep";

const state = vi.hoisted(() => ({ cursor: 0, completed: false }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const overrides: Record<number, unknown> = {
      0: "solar", 1: "US", 3: "solar", 4: "US", 5: "solar", 6: "baseline", 7: [],
      8: { usSummary: { text: "PRIVATE_AI_WORDING", citations: [] }, localSummary: { text: "", citations: [] }, comparison: { text: "", citations: [] }, limitations: [] },
      13: true, 16: { id: "audit-run", privateSalt: "PRIVATE_EPHEMERAL_SALT_12345678901234567890" },
    };
    const index = state.cursor++;
    return [state.completed && index in overrides ? overrides[index] : initial, vi.fn()];
  },
}));

function nodes(tree: unknown): Array<{ type: unknown; props: Record<string, any> }> {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const node = tree as { type: unknown; props: Record<string, any> };
  return [node, ...nodes(node.props.children)];
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); state.cursor = 0; state.completed = false; });

describe("search audit UI", () => {
  it("keeps the evidence register collapsed until the reader opens it", () => {
    state.completed = true;
    const html = renderToStaticMarkup(ResearchSweep({ initialTopic: "", onSearchTopic: vi.fn() }));
    expect(html).toContain('<details class="source-register" id="source-register">');
    expect(html).toContain("View sources and citations");
    expect(html).not.toContain('<details class="source-register" id="source-register" open=""');
  });

  it("keeps the audit absent from the search-first landing", () => {
    const tree = ResearchSweep({ initialTopic: "", onSearchTopic: vi.fn() });
    expect(renderToStaticMarkup(tree)).not.toContain("Download audit JSON");
  });

  it("downloads a local content-free Blob without making a network request", async () => {
    state.completed = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { append } });
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:local-test"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const tree = ResearchSweep({ initialTopic: "", onSearchTopic: vi.fn(), deploymentCommit: "abcdef1" });
    const button = nodes(tree).find(({ type, props }) => type === "button" && props.children === "Download audit JSON");
    expect(button).toBeDefined();
    button!.props.onClick();
    await vi.waitFor(() => expect(anchor.click).toHaveBeenCalledOnce());
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.href).toBe("blob:local-test");
    expect(anchor.download).toBe("atlas-audit-audit-run.json");
    expect(anchor.remove).toHaveBeenCalledOnce();
    const serialized = await blob!.text();
    expect(serialized).not.toContain("PRIVATE_");
    expect(JSON.parse(serialized)).toMatchObject({ schema: "atlas-search-audit/v1", deploymentCommit: "abcdef1", search: { topic: "solar" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a local clipboard alternative without attempting a download or network call", async () => {
    state.completed = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const tree = ResearchSweep({ initialTopic: "", onSearchTopic: vi.fn(), deploymentCommit: "abcdef1" });
    const button = nodes(tree).find(({ type, props }) => type === "button" && props.children === "Copy audit JSON");
    button!.props.onClick();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).not.toContain("PRIVATE_");
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({ schema: "atlas-search-audit/v1", search: { topic: "solar" } });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts a promise-backed clipboard write synchronously inside the click", async () => {
    state.completed = true;
    let itemData: Record<string, Promise<Blob>> = {};
    vi.stubGlobal("ClipboardItem", class { constructor(data: Record<string, Promise<Blob>>) { itemData = data; } });
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const tree = ResearchSweep({ initialTopic: "", onSearchTopic: vi.fn() });
    nodes(tree).find(({ type, props }) => type === "button" && props.children === "Copy audit JSON")!.props.onClick();
    expect(write).toHaveBeenCalledOnce();
    const blob = await itemData["text/plain"];
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).not.toContain("PRIVATE_");
  });
});
