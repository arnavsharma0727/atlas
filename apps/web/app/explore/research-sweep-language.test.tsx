import { beforeEach, describe, expect, it, vi } from "vitest";
import ResearchSweep from "./research-sweep";
import { runResearchSweep } from "../../lib/research-sweep";
import type { ResearchSweepSourceResult } from "../../lib/research-sweep";

const hookState = vi.hoisted(() => ({ cursor: 0, query: "Solar", country: "DE", previousCountry: "KR" }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  // Freeze the render that launches the async search. State setters cannot
  // change that closure, even when a subsequent real React render occurs.
  useState: (initial: unknown) => {
    const index = hookState.cursor++;
    const value = index === 0 ? hookState.query : index === 1 ? hookState.country : index === 4 ? hookState.previousCountry : initial;
    return [value, vi.fn()];
  },
}));
vi.mock("../../lib/research-sweep", () => ({ runResearchSweep: vi.fn() }));

function fixture(key: string, language: string, text: string): ResearchSweepSourceResult {
  return { key, label: "Bluesky", query: "Solar", asOf: "2026-10-12T00:00:00Z", window: "7 days", error: null, status: "complete", evidence: [{
    id: key, title: "Synthetic fixture", url: `https://example.test/${key}`, source: "Bluesky", sourceOperatorKey: "bluesky",
    evidenceClass: "social discussion", language, timeLabel: "Published", timeValue: "2026-10-11T00:00:00Z", transientPreview: text,
  }] };
}

describe("async search language snapshot", () => {
  beforeEach(() => { hookState.cursor = 0; vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it.each([
    ["DE", "KR", "de", "Solar Nachfrage steigt bei niedrigem Angebot."],
    ["FR", "DE", "fr", "Solar demande augmente avec une baisse des prix."],
    ["JP", "FR", "ja", "Solar 市場の需要が増加している。"],
  ])("submits %s evidence, not the previous %s lens", async (country, previousCountry, language, text) => {
    hookState.country = country;
    hookState.previousCountry = previousCountry;
    vi.mocked(runResearchSweep).mockImplementation(async (_query, selection) => selection.blueskyLanguage === "en"
      ? [fixture("bluesky:baseline", "en", "Solar demand is rising while inventories decline.")]
      : [fixture("bluesky:local", language, text)]);
    const fetchMock = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const input = JSON.parse(options?.body as string);
      return Response.json(input.action === "prepare" ? { mode: "localized", query: "Solar", hashtags: ["Solar"] }
        : { mode: "unavailable", reason: "provider-error" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tree = ResearchSweep({ initialTopic: "", onSearchTopic: vi.fn() });
    const form = tree.props.children.find((child: { type?: string } | null) => child?.type === "form");
    form.props.onSubmit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [baselineSelection, localSelection] = vi.mocked(runResearchSweep).mock.calls.map((call) => call[1]);
    expect(baselineSelection).toMatchObject({ theConversation: false, crossref: false, openAlex: false, arxiv: false, pytorch: false, manifoldForecasts: false, stackExchangeQueries: [] });
    expect(localSelection.lemmyInstances).toHaveLength(country === "DE" ? 2 : 1);
    expect(localSelection.stackExchangeQueries).toEqual([]);
    const submitted = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(submitted.action).toBe("summarize");
    expect(submitted.country).toBe(country);
    expect(submitted.evidence.local).toHaveLength(1);
    expect(submitted.evidence.local[0].language).toBe(language);
    expect(submitted.evidence.local[0].excerpt).toBe(text);
  });
});
