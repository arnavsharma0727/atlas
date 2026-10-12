import { describe, expect, it, vi } from "vitest";
import { collapseRepeatedEvidenceViews, evidenceBreadthWarning, filterResultsToTopic, flagRepeatedEvidenceViews, hasMarketSignalTerms, hasTopicSignalTerms, isAttributedReportShare, isIndependentDiscussionEvidence, isLikelyMarketPromotion, isNearDuplicateExcerpt, languageLensMatchMethod, matchesLanguageLens, normalizeMarketSummary, redactSummaryExcerpt, selectBalancedEvidence, summarizeEvidenceBreadth } from "./market-summary";
import { citationKey } from "./perspective-snapshot";
import type { ResearchSweepSourceResult } from "./research-sweep";
import { summarizeCitedEvidenceBreadth } from "./market-summary";

function result(key: string, source: string, evidence: ResearchSweepSourceResult["evidence"]): ResearchSweepSourceResult {
  return { key, label: source, query: "solar", asOf: "2026-10-10T00:00:00.000Z", retrievedAt: "2026-10-10T00:00:01.000Z", window: "7 days", evidence, error: null, status: "complete" };
}

function evidence(id: string, source: string, excerpt: string, operator = source) {
  return {
    id, title: `Post by @private-handle-${id}`, url: `https://example.test/${id}`, source,
    evidenceClass: "social discussion" as const, language: "English", timeLabel: "Published",
    timeValue: "2026-10-10T00:00:00.000Z", transientPreview: excerpt,
    sourceOperatorKey: operator,
  };
}

describe("market summary evidence contracts", () => {
  it("keeps explicitly mapped official energy benchmark records for a broad energy query", () => {
    const row = {
      id: "eia:RWTC:2026-10-09", title: "U.S. energy benchmark · Cushing WTI crude · 72.20 USD/barrel · 2026-10-09",
      url: "https://www.eia.gov/opendata/browser/petroleum/pri/spt?series=RWTC", source: "EIA",
      evidenceClass: "official statistical data" as const, language: "Not applicable", timeLabel: "Observation date",
      timeValue: "2026-10-09T00:00:00.000Z", context: "U.S.-based benchmark, not a local price or public opinion.",
    };
    const [screened] = filterResultsToTopic([result("eia-energy-prices", "EIA", [row])], "energy prices");
    expect(screened.evidence).toEqual([row]);
    const koreanMacro = { ...row, id: "world-bank:FP.CPI.TOTL.ZG:KOR:2025", title: "Korea · Inflation, consumer prices · 2025" };
    const [localized] = filterResultsToTopic([result("world-bank-macro", "World Bank", [koreanMacro])], "물가상승");
    expect(localized.evidence).toEqual([koreanMacro]);
  });

  it("keeps BIS exchange-rate statistics as citations but never chooses them for a discussion summary", () => {
    const row = {
      id: "bis-eer:KR:N:2026-08", title: "South Korea nominal effective exchange rate", url: "https://data.bis.org/topics/EER/BIS%2CWS_EER%2C1.0/M.N.B.KR",
      source: "BIS", evidenceClass: "official statistical data" as const, language: "Not applicable", timeLabel: "Latest monthly observation",
      timeValue: "2026-08", summaryEligible: false, transientPreview: "currency exchange rate index market change",
    };
    const [screened] = filterResultsToTopic([result("bis-effective-exchange", "BIS", [row])], "currency exchange rate");
    expect(screened.evidence).toEqual([row]);
    const selected = selectBalancedEvidence(
      [screened],
      new Map([[citationKey("bis-effective-exchange", row.id), "C1"]]),
      8,
      new Set(),
      undefined,
      () => true,
    );
    expect(selected).toEqual([]);
  });

  it("reports per-source overview candidates before the final platform cap", () => {
    const rows = result("bluesky", "Bluesky", [
      evidence("one", "Bluesky", "Solar demand rose as module prices fell.", "bluesky"),
      evidence("two", "Bluesky", "Solar supply improved while inventories declined.", "bluesky"),
    ]);
    const candidates: string[] = [];
    const selected = selectBalancedEvidence(
      [rows],
      new Map([[citationKey("bluesky", "one"), "C1"], [citationKey("bluesky", "two"), "C2"]]),
      1,
      new Set(),
      undefined,
      (item) => hasMarketSignalTerms(item) && hasTopicSignalTerms(item.excerpt, "solar"),
      undefined,
      (sourceKey) => candidates.push(sourceKey),
    );

    expect(candidates).toEqual(["bluesky", "bluesky"]);
    expect(selected).toHaveLength(1);
  });

  it("collapses exact same-network URL copies in display while preserving raw counts and cross-network provenance", () => {
    const original = evidence("post-a", "Lemmy", "A public post about market prices.", "lemmy-federation");
    const copy = { ...evidence("post-b", "Lemmy", "A public post about market prices.", "lemmy-federation"), url: `${original.url}?utm_source=instance` };
    const raw = [result("lemmy:one", "Lemmy · instance one", [original]), result("lemmy:two", "Lemmy · instance two", [copy])];
    const views = collapseRepeatedEvidenceViews(raw);
    expect(raw.map((view) => view.evidence.length)).toEqual([1, 1]);
    expect(views.map((view) => view.evidence.length)).toEqual([1, 0]);
    expect(views.map((view) => [view.returnedCount, view.duplicateCount])).toEqual([[1, 0], [1, 1]]);
    expect(views[0].evidence[0].context).toContain("Lemmy · instance two");
    expect(views[1].result.evidence).toHaveLength(1);
  });

  it("collapses a six-server Lemmy federation copy to one displayed source record", () => {
    const url = "https://lemmy.world/post/semiconductor-1";
    const hosts = ["lemmy.world", "discuss.tchncs.de", "feddit.org", "jlai.lu", "sopuli.xyz", "sh.itjust.works"];
    const rows = hosts.map((host) => result(`lemmy:${host}`, `Lemmy · ${host}`, [
      { ...evidence(host, `Lemmy · ${host}`, "Semiconductor supply and pricing discussion.", "lemmy-federation"), url },
    ]));
    const views = collapseRepeatedEvidenceViews(rows);

    expect(views.map(({ evidence: items }) => items.length)).toEqual([1, 0, 0, 0, 0, 0]);
    expect(views.map(({ returnedCount, duplicateCount }) => [returnedCount, duplicateCount])).toEqual([
      [1, 0], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1],
    ]);
    expect(views[0].evidence[0].context).toContain("one original record, not independent corroboration");
  });

  it("does not collapse identical-looking links across different source operators", () => {
    const sameUrl = "https://example.test/shared";
    const rows = [
      result("lemmy", "Lemmy", [{ ...evidence("a", "Lemmy", "A short post", "lemmy-federation"), url: sameUrl }]),
      result("mastodon", "Mastodon", [{ ...evidence("b", "Mastodon", "A short post", "mastodon-network"), url: sameUrl }]),
    ];
    expect(collapseRepeatedEvidenceViews(rows).map((view) => view.evidence.length)).toEqual([1, 1]);
  });

  it("collapses long exact same-network copied text even if its URL differs", () => {
    const text = "Investors described stronger demand across several major customers, while warning that export controls and inventory levels could shift near-term pricing. They said order visibility remains uneven and new supply may alter the outlook over the next two quarters.";
    const rows = [
      result("lemmy:a", "Lemmy A", [evidence("a", "Lemmy", text, "lemmy-federation")]),
      result("lemmy:b", "Lemmy B", [{ ...evidence("b", "Lemmy", text, "lemmy-federation"), url: "https://example.test/different" }]),
    ];
    expect(collapseRepeatedEvidenceViews(rows).map((view) => view.evidence.length)).toEqual([1, 0]);
  });

  it("redacts embedded links, emails, and handles from excerpts before model submission", () => {
    expect(redactSummaryExcerpt("Shared by (@market.reader), contact analyst@example.org or https://example.org/report.")).toBe("Shared by ([handle]), contact [email] or [link]");
  });

  it("preserves link-sharing provenance while redacting the destination URL for AI", () => {
    const linked = { ...evidence("linked", "Bluesky", "Revenue rose, according to this article https://publisher.example/story", "bluesky"), linkSharing: true };
    const selected = selectBalancedEvidence([result("bluesky", "Bluesky", [linked])], new Map([
      [citationKey("bluesky", "linked"), "C1"],
    ]));
    expect(selected).toEqual([expect.objectContaining({
      citationId: "C1",
      excerpt: "Revenue rose, according to this article [link]",
      linkSharing: true,
    })]);
    expect(JSON.stringify(selected)).not.toContain("publisher.example");
  });

  it("does not treat externally linked posts as independent AI-summary evidence", () => {
    expect(isIndependentDiscussionEvidence({ linkSharing: true })).toBe(false);
    expect(isIndependentDiscussionEvidence({ linkSharing: false })).toBe(true);
    expect(isIndependentDiscussionEvidence({})).toBe(true);
  });

  it("keeps high-confidence stock-pitch copy visible but out of the community overview", () => {
    const pitch = "📈 비메모리 테스트 1위의 귀환! 반도체 수요, 두산테스나 전고점 뚫을 핵심 모멘텀 3선. 두산테스나 주가 전망과 매수 추천.";
    const secondPitch = "글로벌 1위 장비주의 위엄! 반도체 수요, 피에스케이 전고점 뚫고 20만원 찍을 수밖에 없는 4가지 이유.";
    expect(isLikelyMarketPromotion(pitch)).toBe(true);
    expect(isLikelyMarketPromotion(secondPitch)).toBe(true);
    expect(isIndependentDiscussionEvidence({ excerpt: pitch })).toBe(false);
    expect(isLikelyMarketPromotion("Semiconductor demand remains uncertain after several inventory changes.")).toBe(false);
    const screened = filterResultsToTopic([result("local:bluesky", "Bluesky", [{
      ...evidence("pitch", "Bluesky", pitch), title: pitch,
    }])], "semiconductors", "반도체 수요");
    expect(screened[0].evidence[0].context).toContain("stock-promotion/clickbait");
  });

  it.each([
    ["German", "Garantierte Rendite und Kaufempfehlung für diese Aktien.", "Der Marktausblick bleibt unsicher und die Nachfrage entwickelt sich unterschiedlich."],
    ["French", "Rendement garanti et recommandation d'achat pour ces actions.", "La demande du marché reste incertaine malgré une amélioration de l'offre."],
    ["Spanish", "Rentabilidad garantizada y recomendación de compra para estas acciones.", "La demanda del mercado sigue incierta y los precios varían."],
    ["Portuguese", "Rentabilidade garantida e recomendação de compra destas ações.", "A demanda do mercado continua incerta e os preços variam."],
    ["Hindi", "गारंटीड रिटर्न और शेयर खरीदने की सिफारिश।", "बाज़ार में मांग और कीमतों को लेकर अनिश्चितता है।"],
  ])("screens explicit %s stock-promotion phrases without flagging neutral market discussion", (_language, pitch, discussion) => {
    expect(isLikelyMarketPromotion(pitch)).toBe(true);
    expect(isLikelyMarketPromotion(discussion)).toBe(false);
    expect(isIndependentDiscussionEvidence({ excerpt: pitch })).toBe(false);
    expect(isIndependentDiscussionEvidence({ excerpt: discussion })).toBe(true);
  });

  it("does not treat posts explicitly attributed to a publisher as independent views", () => {
    const repost = "SK Group Chairman Chey Tae-won stated that capacity needs to expand. Source: The Korea Herald";
    expect(isAttributedReportShare(repost)).toBe(true);
    expect(isIndependentDiscussionEvidence({ excerpt: repost })).toBe(false);
    const screened = filterResultsToTopic([result("bluesky", "Bluesky", [{
      ...evidence("repost", "Bluesky", repost), title: "Semiconductor demand and capacity",
    }])], "semiconductors");
    expect(screened[0].evidence[0].context).toContain("explicitly attributes its material to a publisher");
  });

  it("keeps linked posts in results but screens them out of summary evidence", () => {
    const linked = { ...evidence("linked", "Bluesky", "Semiconductor demand rose. news.example.com/story"), linkSharing: true };
    const rows = [result("bluesky", "Bluesky", [linked])];
    const citations = new Map([[citationKey("bluesky", "linked"), "C1"]]);
    let screenedOut = 0;

    expect(rows[0].evidence).toHaveLength(1);
    expect(selectBalancedEvidence(rows, citations, 8, new Set(), undefined, isIndependentDiscussionEvidence, () => screenedOut++)).toEqual([]);
    expect(screenedOut).toBe(1);
  });

  it("adds a redacted link marker when the source HTML link is absent from the visible excerpt", () => {
    const linked = { ...evidence("mastodon", "Mastodon", "Revenue rose after the announcement.", "mastodon-network"), linkSharing: true };
    const selected = selectBalancedEvidence([result("mastodon", "Mastodon", [linked])], new Map([
      [citationKey("mastodon", "mastodon"), "C1"],
    ]));
    expect(selected[0].excerpt).toBe("Revenue rose after the announcement. [link]");
    expect(selected[0].linkSharing).toBe(true);
  });

  it("screens generic lifestyle mentions while recognizing explicit market-language signals", () => {
    expect(hasMarketSignalTerms({ excerpt: "I need a coffee before my shift starts.", language: "English" })).toBe(false);
    expect(hasMarketSignalTerms({ excerpt: "Coffee prices rose as supply tightened and inventories fell.", language: "en" })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: "O preço do café caiu após a safra recorde.", language: "pt-BR" })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: "커피 수요와 원자재 가격이 상승했다.", language: "ko" })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: "The smell of coffee fills the room.", language: "Lemmy language ID 0" })).toBe(false);
    expect(hasMarketSignalTerms({ excerpt: "시장 수요가 증가했다.", language: "Lemmy language ID 0" })).toBe(true);
  });

  it("recognizes accented French market vocabulary in either Unicode composition", () => {
    const excerpt = "Le marché du cuivre ralentit.";
    for (const language of ["fr", "French", "fr-FR", "not provided"]) {
      expect(hasMarketSignalTerms({ excerpt, language })).toBe(true);
      expect(hasMarketSignalTerms({ excerpt: excerpt.normalize("NFD"), language })).toBe(true);
    }
  });

  it.each([
    ["en", "Inflation is slowing.", "Unemployment remains elevated."],
    ["fr", "Le chômage augmente.", "La récession persiste."],
    ["de", "Die Rezession hält an.", "Die Arbeitslosenquote steigt."],
    ["es", "La inflación está bajando.", "El desempleo sigue elevado."],
    ["pt", "A inflação está caindo.", "O desemprego continua alto."],
    ["ko", "인플레이션이 둔화되고 있다.", "실업이 늘고 있다."],
    ["ja", "インフレが鈍化している。", "失業が増えている。"],
    ["hi", "महंगाई कम हो रही है।", "बेरोजगारी बढ़ रही है।"],
  ])("recognizes core macroeconomic concepts in %s without requiring stock vocabulary", (language, first, second) => {
    expect(hasMarketSignalTerms({ excerpt: first, language })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: second, language })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: first.normalize("NFD"), language })).toBe(true);
  });

  it("does not turn the macro vocabulary addition into a stem or general lifestyle matcher", () => {
    for (const excerpt of ["I am inflating birthday balloons.", "A recessional song played.", "éinflationé", "_gdp_", "Coffee before work."]) {
      expect(hasMarketSignalTerms({ excerpt, language: "en" }), excerpt).toBe(false);
    }
    expect(hasMarketSignalTerms({ excerpt: "Inflation is slowing.", language: "not provided" })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: "Inflation is slowing.", language: "ja" })).toBe(false);
  });

  it.each([
    ["en", "price"], ["fr", "marché"], ["de", "preis"], ["es", "inversión"], ["pt", "preço"],
  ])("uses Unicode token boundaries without expanding the %s vocabulary", (language, term) => {
    expect(hasMarketSignalTerms({ excerpt: `(${term})`, language })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: term.toLocaleUpperCase(), language })).toBe(true);
    for (const excerpt of [`é${term}`, `${term}é`, `${term}\u0301`, `क${term}`, `${term}क`, `_${term}`, `${term}_`]) {
      expect(hasMarketSignalTerms({ excerpt, language }), excerpt).toBe(false);
    }
  });

  it("requires a topic match as well as market language and accepts a small set of clear market aliases", () => {
    expect(hasTopicSignalTerms("Critical minerals and industrial supply demand are changing.", "semiconductor demand")).toBe(false);
    expect(hasTopicSignalTerms("GPU chip demand is accelerating.", "semiconductor demand")).toBe(true);
    expect(hasTopicSignalTerms("Semiconductor demand is accelerating.", "semiconductor demand")).toBe(true);
    expect(hasTopicSignalTerms("반도체 수요가 증가했다.", "반도체 수요")).toBe(true);
    expect(hasTopicSignalTerms("Demand increased across markets.", "semiconductor demand")).toBe(false);
    expect(hasTopicSignalTerms("Supply is tightening.", "demand and supply")).toBe(false);
  });

  it("requires every independent subject in a multi-part topic while allowing reviewed aliases", () => {
    expect(hasTopicSignalTerms("GPU demand is accelerating.", "Nvidia semiconductor demand")).toBe(false);
    expect(hasTopicSignalTerms("Nvidia demand is accelerating.", "Nvidia semiconductor demand")).toBe(false);
    expect(hasTopicSignalTerms("Nvidia GPU demand is accelerating.", "Nvidia semiconductor demand")).toBe(true);
    expect(hasTopicSignalTerms("Nvidia semiconductor demand is accelerating.", "Nvidia semiconductor demand")).toBe(true);
    expect(hasTopicSignalTerms("EV demand is accelerating.", "electric vehicle demand")).toBe(true);
    expect(hasTopicSignalTerms("EV sales are accelerating.", "Tesla electric vehicle sales")).toBe(false);
    expect(hasTopicSignalTerms("Tesla EV sales are accelerating.", "Tesla electric vehicle sales")).toBe(true);
  });

  it("does not confuse natural-gas searches with generic gas or gasoline chatter", () => {
    expect(hasTopicSignalTerms("Gas prices rose after a refinery outage.", "natural gas prices")).toBe(false);
    expect(hasTopicSignalTerms("Gasoline prices rose as refinery inventories fell.", "natural gas prices")).toBe(false);
    expect(hasTopicSignalTerms("Natural gas demand rose as storage levels fell.", "natural gas prices")).toBe(true);
    expect(hasTopicSignalTerms("LNG demand rose as Asian spot prices climbed.", "natural gas prices")).toBe(true);
    expect(hasTopicSignalTerms("Henry Hub prices fell after storage data.", "natural gas prices")).toBe(true);
  });

  it("keeps company constraints when resolving natural-gas aliases", () => {
    expect(hasTopicSignalTerms("LNG demand rose in Asia.", "Shell natural gas demand")).toBe(false);
    expect(hasTopicSignalTerms("Shell gasoline sales rose.", "Shell natural gas demand")).toBe(false);
    expect(hasTopicSignalTerms("Shell LNG sales rose.", "Shell natural gas demand")).toBe(true);
    expect(hasTopicSignalTerms("Shell LNG sales rose.", "Shell प्राकृतिक गैस मांग")).toBe(true);
    expect(hasTopicSignalTerms("प्राकृतिक गैस की मांग बढ़ी।", "Shell प्राकृतिक गैस मांग")).toBe(false);
    expect(hasTopicSignalTerms("टाटा की बिक्री बढ़ी।", "टाटा मांग")).toBe(true);
    expect(hasTopicSignalTerms("टाटामोटर्स की बिक्री बढ़ी।", "टाटा मांग")).toBe(false);
  });

  it.each([
    ["Spanish", "Gasolina y precios de combustibles", "Los precios del gas natural subieron por la demanda."],
    ["Portuguese", "O preço da gasolina subiu após a refinaria", "A demanda por gás natural cresceu no inverno."],
    ["French", "Le prix de l'essence augmente", "La demande de gaz naturel progresse en Europe."],
    ["German", "Benzinpreise stiegen nach dem Raffinerieausfall", "Die Erdgaspreise steigen wegen höherer Nachfrage."],
    ["Korean", "휘발유 가격이 상승했다.", "천연가스 수요와 가격이 상승했다."],
    ["Japanese", "ガソリン価格が上昇した。", "天然ガスの需要と価格が上がった。"],
    ["Hindi", "पेट्रोल की कीमतें बढ़ीं।", "प्राकृतिक गैस की मांग और कीमत बढ़ीं।"],
  ])("disambiguates the natural-gas concept in %s queries", (_language, genericGas, naturalGas) => {
    const localPhrase = naturalGas.match(/(?:gas\s+natural|gás\s+natural|gaz\s+naturel|erdgas|천연가스|天然ガス|प्राकृतिक\s+गैस)/iu)?.[0];
    expect(localPhrase).toBeTruthy();
    expect(hasTopicSignalTerms(genericGas, localPhrase!)).toBe(false);
    expect(hasTopicSignalTerms(naturalGas, localPhrase!)).toBe(true);
  });

  it("filters off-topic displayed evidence while preserving raw provider counts and per-lens wording", () => {
    const rows = [
      result("bluesky", "Bluesky", [
        evidence("off-topic", "Bluesky", "Critical minerals and industrial demand are changing."),
        evidence("on-topic", "Bluesky", "GPU chip demand is accelerating."),
      ]),
      result("local:bluesky", "Korean Bluesky", [
        { ...evidence("local-on-topic", "Bluesky", "반도체 수요와 가격이 상승했다."), language: "Korean" },
        { ...evidence("local-off-topic", "Bluesky", "철강 수요와 가격이 상승했다."), language: "Korean" },
      ]),
    ];
    const filtered = filterResultsToTopic(rows, "semiconductor demand", "반도체 수요");
    expect(filtered.map(({ evidence }) => evidence.map(({ id }) => id))).toEqual([["on-topic"], ["local-on-topic"]]);
    expect(filtered.map(({ providerReturnedCount, topicExcludedCount }) => [providerReturnedCount, topicExcludedCount])).toEqual([[2, 1], [2, 1]]);
    expect(collapseRepeatedEvidenceViews(filtered).map(({ returnedCount }) => returnedCount)).toEqual([2, 2]);
  });

  it("applies the market-language screen before the balanced eight-item cap", () => {
    let excluded = 0;
    const irrelevant = Array.from({ length: 8 }, (_, index) => evidence(`lifestyle-${index}`, "Bluesky", `A morning cup feels cozy on day ${index}.`, "bluesky"));
    const relevantA = evidence("market-a", "Bluesky", "Coffee demand and prices are rising.", "bluesky");
    const relevantB = evidence("market-b", "Mastodon", "Coffee supply tightened as prices increased.", "mastodon-network");
    const rows = [
      result("bluesky", "Bluesky", [...irrelevant, relevantA]),
      result("mastodon", "Mastodon", [relevantB]),
    ];
    const citations = new Map([
      ...irrelevant.map((item) => [citationKey("bluesky", item.id), `C${Number(item.id.split("-")[1]) + 1}`] as const),
      [citationKey("bluesky", "market-a"), "C20"],
      [citationKey("mastodon", "market-b"), "C21"],
    ]);
    const selected = selectBalancedEvidence(
      rows, citations, 2, new Set(), undefined, hasMarketSignalTerms, () => excluded++,
    );
    expect(selected.map(({ citationId }) => citationId)).toEqual(["C20", "C21"]);
    expect(excluded).toBe(8);
  });

  it("limits a prolific account to one excerpt per provider in each overview", () => {
    const repeatedAuthor = [
      { ...evidence("author-1", "Bluesky", "Semiconductor demand is accelerating.", "bluesky"), attribution: "Author: @one-account", attributionUrl: "https://bsky.app/profile/one-account" },
      { ...evidence("author-2", "Bluesky", "Semiconductor supply is tightening.", "bluesky"), attribution: "Author: @one-account", attributionUrl: "https://bsky.app/profile/one-account" },
    ];
    const otherAuthor = { ...evidence("author-3", "Bluesky", "Chip inventory is falling.", "bluesky"), attribution: "Author: @another-account", attributionUrl: "https://bsky.app/profile/another-account" };
    const citations = new Map([
      [citationKey("bluesky", "author-1"), "C1"],
      [citationKey("bluesky", "author-2"), "C2"],
      [citationKey("bluesky", "author-3"), "C3"],
    ]);
    const selected = selectBalancedEvidence([result("bluesky", "Bluesky", [...repeatedAuthor, otherAuthor])], citations, 8);
    expect(selected.map(({ citationId }) => citationId)).toEqual(["C1", "C3"]);
    expect(JSON.stringify(selected)).not.toContain("one-account");
  });

  it.each([
    ["en", "Bond yields rose as interest rates changed.", "I drink coffee before work."],
    ["pt-BR", "A taxa de juros caiu e o câmbio mudou.", "Tomo café todas as manhãs."],
    ["es", "El tipo de cambio cayó y subió la rentabilidad.", "Tomo café cada mañana."],
    ["fr", "Le chiffre d’affaires a progressé malgré la baisse du cours boursier.", "J’aime le café au petit déjeuner."],
    ["de", "Der Aktienkurs stieg; die Rendite blieb stabil.", "Ich trinke morgens Kaffee."],
    ["ko", "시가총액과 영업이익이 증가했다.", "매일 아침 커피를 마신다."],
    ["ja", "時価総額と営業利益が増加した。", "毎朝コーヒーを飲む。"],
    ["hi", "शेयर बाज़ार में ब्याज दर और लाभांश पर चर्चा हुई।", "मैं हर सुबह चाय पीता हूँ।"],
  ])("recognizes ordinary market vocabulary but not lifestyle text in %s", (language, relevant, lifestyle) => {
    expect(hasMarketSignalTerms({ excerpt: relevant, language })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: lifestyle, language })).toBe(false);
  });

  it("flags overlapping provider views without reducing their returned record counts", () => {
    const original = evidence("a", "Lemmy", "same public post", "lemmy-federation");
    const repeated = { ...evidence("b", "Lemmy", "SAME PUBLIC POST", "lemmy-federation"), url: original.url };
    const [first, second] = flagRepeatedEvidenceViews([
      result("lemmy:a", "Lemmy A", [original]),
      result("lemmy:b", "Lemmy B", [repeated]),
    ]);
    expect(first.evidence).toHaveLength(1);
    expect(first.sourceNote).toContain("Possible duplication: 1 of 1 returned records");
    expect(first.evidence[0].context).toContain("Same source URL appears in 2 query/server views");
    expect(second.sourceNote).toContain("not independent corroboration");
  });

  it("marks and excludes long exact cross-platform copies from independent summary evidence", () => {
    const sharedText = "Investors described a rapid increase in memory-chip demand across several major cloud customers, while warning that export rules and inventory levels could change the outlook over the next two quarters. They said order visibility remains uneven and pricing may depend on supply additions.";
    const bluesky = evidence("post-a", "Bluesky", sharedText, "bluesky");
    const mastodon = evidence("post-b", "Mastodon", sharedText, "mastodon-network");
    const input = [result("bluesky", "Bluesky", [bluesky]), result("mastodon", "Mastodon", [mastodon])];
    const flagged = flagRepeatedEvidenceViews(input);
    expect(flagged[1].evidence[0].context).toContain("across multiple source operators");
    const citations = new Map([
      [citationKey("bluesky", "post-a"), "C1"],
      [citationKey("mastodon", "post-b"), "C2"],
    ]);
    expect(selectBalancedEvidence(flagged, citations)).toHaveLength(1);
    expect(selectBalancedEvidence([result("one", "A", [evidence("a", "A", "I agree.", "operator-a")]), result("two", "B", [evidence("b", "B", "I agree.", "operator-b")])], new Map([
      [citationKey("one", "a"), "C1"], [citationKey("two", "b"), "C2"],
    ]))).toHaveLength(2);
  });

  it("deduplicates the same DOI across independent metadata providers", () => {
    const doi = "https://doi.org/10.1234/shared-paper.1";
    const crossref = { ...evidence("doi-a", "Crossref", "A scholarly record", "crossref"), url: doi };
    const openalex = { ...evidence("doi-b", "OpenAlex", "The same scholarly record", "openalex"), url: "https://DOI.org/10.1234/shared-paper.1?utm_source=atlas#metadata" };
    const results = flagRepeatedEvidenceViews([
      result("crossref", "Crossref", [crossref]),
      result("openalex", "OpenAlex", [openalex]),
    ]);
    expect(results[1].evidence[0].context).toContain("Same source URL appears in 2 query/server views");
    const citations = new Map([
      [citationKey("crossref", "doi-a"), "C1"],
      [citationKey("openalex", "doi-b"), "C2"],
    ]);
    expect(selectBalancedEvidence(results, citations)).toHaveLength(1);
  });

  it("flags and excludes only long, near-identical copies from model evidence while keeping both citations visible", () => {
    const firstText = "Investors described demand for advanced chips as strong while warning that export restrictions could constrain shipments across major markets this quarter. Companies are watching order trends, inventory levels, and customer spending before changing their outlook. This remains uncertain.";
    const secondText = firstText.replace("This remains uncertain.", "The outlook remains uncertain.");
    expect(isNearDuplicateExcerpt(firstText, secondText)).toBe(true);
    expect(isNearDuplicateExcerpt("short post", "short post with a few words added")).toBe(false);
    expect(isNearDuplicateExcerpt(firstText, "Investors discussed a different commodity market after supply disruptions affected shipping costs. Traders disagreed about potential demand, inventories, company guidance, and future pricing trends across regions.")).toBe(false);
    const japaneseText = "半導体市場では投資家が需要の見通しと在庫水準を慎重に見極めています。輸出規制や顧客の支出が今後の出荷に影響する可能性があり、複数の企業は次の四半期まで大きな判断を保留しています。".repeat(2);
    expect(isNearDuplicateExcerpt(japaneseText, japaneseText.replace("慎重に見極めています", "注意深く確認しています"))).toBe(true);
    const a = evidence("a", "Bluesky", firstText, "bluesky");
    const b = { ...evidence("b", "Bluesky", secondText, "bluesky"), url: "https://example.test/other" };
    const results = flagRepeatedEvidenceViews([
      result("blue:one", "Bluesky", [a]),
      result("blue:two", "Bluesky", [b]),
    ]);
    expect(results.flatMap(({ evidence: items }) => items)).toHaveLength(2);
    expect(results[0].evidence[0].context).toContain("Near-identical long-form text");
    const citations = new Map([
      [citationKey("blue:one", "a"), "C1"],
      [citationKey("blue:two", "b"), "C2"],
    ]);
    expect(selectBalancedEvidence(results, citations, 8)).toHaveLength(1);
  });

  it("flags and excludes conservative near-copies syndicated across different operators", () => {
    const firstText = "Investors described demand for advanced chips as strong while warning that export restrictions could constrain shipments across major markets this quarter. Companies are watching order trends, inventory levels, and customer spending before changing their outlook. This remains uncertain.";
    const secondText = firstText.replace("This remains uncertain.", "The outlook remains uncertain.");
    const input = [
      result("blue:one", "Bluesky", [evidence("a", "Bluesky", firstText, "bluesky")]),
      result("mastodon:one", "Mastodon", [evidence("b", "Mastodon", secondText, "mastodon-network")]),
    ];
    const flagged = flagRepeatedEvidenceViews(input);
    expect(flagged[0].evidence[0].context).toContain("across different source operators");
    expect(flagged[1].evidence[0].context).toContain("syndicated or cross-posted");
    const citations = new Map([
      [citationKey("blue:one", "a"), "C1"],
      [citationKey("mastodon:one", "b"), "C2"],
    ]);
    expect(selectBalancedEvidence(flagged, citations, 8)).toHaveLength(1);
  });

  it("balances distinct operators and omits source URLs, attribution handles, and authors from model input", () => {
    const results = [
      result("blue", "Bluesky", [evidence("b1", "Bluesky", "A first view from (@member123.example), contact analyst@private.example.", "bluesky"), evidence("b2", "Bluesky", "A second view", "bluesky")]),
      result("lemmy", "Lemmy · lemmy.world", [evidence("l1", "Lemmy · lemmy.world", "A forum view", "lemmy-federation")]),
      result("mastodon", "Mastodon · mastodon.social", [evidence("m1", "Mastodon · mastodon.social", "A hashtag view", "mastodon-network")]),
    ];
    const citations = new Map([
      [citationKey("blue", "b1"), "C1"], [citationKey("blue", "b2"), "C2"],
      [citationKey("lemmy", "l1"), "C3"], [citationKey("mastodon", "m1"), "C4"],
    ]);
    const selected = selectBalancedEvidence(results, citations, 3);
    expect(selected.map(({ citationId }) => citationId)).toEqual(["C1", "C3", "C4"]);
    expect(selected[0]).toMatchObject({ title: "Public discussion post", excerpt: "A first view from ([handle]), contact [email]." });
    expect(JSON.stringify(selected)).not.toContain("https://");
    expect(JSON.stringify(selected)).not.toContain("private-handle");
    expect(JSON.stringify(selected)).not.toContain("@member123");
    expect(JSON.stringify(selected)).not.toContain("analyst@private.example");
  });

  it("reports the exact excerpt count and distinct platforms used for each overview", () => {
    expect(summarizeEvidenceBreadth([
      { source: "Bluesky public AppView · search 1" },
      { source: "Bluesky public AppView · search 2" },
      { source: "Lemmy · lemmy.world / c/economics" },
      { source: "Mastodon · mastodon.social via mastodon.social" },
    ])).toEqual({ excerptCount: 4, platformLabels: ["Bluesky", "Lemmy", "Mastodon"] });
    expect(summarizeEvidenceBreadth([])).toEqual({ excerptCount: 0, platformLabels: [] });
  });

  it("counts only cited originals, not every platform selected as input", () => {
    const rows = [
      result("bluesky", "Bluesky", [evidence("a", "Bluesky", "Solar demand is rising.")]),
      result("lemmy", "Lemmy", [evidence("b", "Lemmy", "Solar supply is falling.")]),
      result("mastodon", "Mastodon", [evidence("c", "Mastodon", "Solar prices are changing.")]),
    ];
    const citations = new Map([[citationKey("bluesky", "a"), "C1"], [citationKey("lemmy", "b"), "C2"], [citationKey("mastodon", "c"), "C3"]]);
    expect(summarizeCitedEvidenceBreadth(rows, citations, ["C1", "C1", "C999"]))
      .toEqual({ excerptCount: 1, platformLabels: ["Bluesky"] });
    expect(summarizeCitedEvidenceBreadth(rows, citations, ["C1", "C2"]))
      .toEqual({ excerptCount: 2, platformLabels: ["Bluesky", "Lemmy"] });
    expect(summarizeCitedEvidenceBreadth(rows, citations, []))
      .toEqual({ excerptCount: 0, platformLabels: [] });
  });

  it("does not count multiple citation IDs for the same original as extra support", () => {
    const original = evidence("a", "Mastodon · mastodon.social", "Solar demand is rising.");
    const copy = { ...original, id: "b", source: "Mastodon · other instance", url: `${original.url}?utm_source=copy` };
    const rows = [result("mastodon:a", "Mastodon", [original]), result("mastodon:b", "Mastodon", [copy])];
    const citations = new Map([[citationKey("mastodon:a", "a"), "C1"], [citationKey("mastodon:b", "b"), "C2"]]);
    expect(summarizeCitedEvidenceBreadth(rows, citations, ["C1", "C2"]))
      .toEqual({ excerptCount: 1, platformLabels: ["Mastodon"] });
  });

  it("warns when an overview has no evidence or only one platform", () => {
    expect(evidenceBreadthWarning({ excerptCount: 0, platformLabels: [] })).toContain("cannot be assessed");
    expect(evidenceBreadthWarning({ excerptCount: 5, platformLabels: ["Bluesky"] })).toBe(
      "Single-platform sample (Bluesky); this is not a cross-community view.",
    );
    expect(evidenceBreadthWarning({ excerptCount: 5, platformLabels: ["Bluesky", "Lemmy"] })).toBeNull();
  });

  it("includes only matching or conservatively script-detected language records without hiding source results", () => {
    const english = evidence("en", "Mastodon", "An English market view", "mastodon-network");
    const portuguese = { ...evidence("pt", "Mastodon", "Uma visão do mercado", "mastodon-network"), language: "pt-BR" };
    const unknown = { ...evidence("unknown", "Lemmy", "A forum view with unmapped language metadata", "lemmy-federation"), language: "Lemmy language metadata ID 0 (instance-specific; language not mapped)" };
    const results = [result("local:mastodon", "Mastodon", [english, portuguese]), result("local:lemmy", "Lemmy", [unknown])];
    const citations = new Map([
      [citationKey("local:mastodon", "en"), "C1"],
      [citationKey("local:mastodon", "pt"), "C2"],
      [citationKey("local:lemmy", "unknown"), "C3"],
    ]);
    expect(selectBalancedEvidence(results, citations, 8, new Set(), "pt").map(({ citationId }) => citationId)).toEqual(["C2"]);
    expect(results[0].evidence).toHaveLength(2);
    expect(results[1].evidence).toHaveLength(1);
  });

  it.each([
    ["Korean", "반도체 수요와 시장 전망에 대한 의견입니다", "ko"],
    ["Japanese", "半導体の需要について市場の意見です", "ja"],
    ["Hindi", "सेमीकंडक्टर बाजार में मांग और कीमतों पर चर्चा", "hi"],
  ])("detects %s text when provider language is not supplied", (_label, text, expected) => {
    expect(matchesLanguageLens("not provided", expected, text)).toBe(true);
    expect(languageLensMatchMethod("not provided", expected, text)).toBe("script-detection");
  });

  it("records script-based language attribution on the original source card", () => {
    const text = "반도체 수요와 시장 전망에 대한 의견입니다";
    const local = { ...evidence("ko", "Bluesky", text), title: "반도체 수요", language: "not provided" };
    const screened = filterResultsToTopic([result("local:bluesky", "Bluesky", [local])], "semiconductors", "반도체 수요", "ko");
    expect(screened[0].evidence[0].context).toContain("matched the selected ko language lens by script only");
  });

  it("does not override an explicit conflicting language label or guess Latin-script language", () => {
    expect(matchesLanguageLens("en", "ko", "반도체 수요와 시장 전망에 대한 의견입니다")).toBe(false);
    expect(matchesLanguageLens("not provided", "fr", "Le marché de la demande évolue")).toBe(false);
  });

  it.each([
    ["en", "English"], ["ko", "Korean"], ["ja", "Japanese"], ["de", "German"],
    ["fr", "French"], ["pt", "Portuguese"], ["hi", "Hindi"], ["es", "Spanish"],
  ])("accepts language code %s for provider label %s", (expected, reported) => {
    const item = { ...evidence("localized", "Bluesky", "A market view"), language: reported };
    const rows = [result("local:bluesky", "Bluesky", [item])];
    const citations = new Map([[citationKey("local:bluesky", "localized"), "C1"]]);
    expect(selectBalancedEvidence(rows, citations, 8, new Set(), expected)).toHaveLength(1);
  });

  it("never sends headline-only expert-analysis records to the discussion summarizer", () => {
    const headline = { ...evidence("tc", "The Conversation · Australia edition", "", "the-conversation"), transientPreview: undefined, evidenceClass: "expert analysis" as const };
    const results = [result("the-conversation:au", "The Conversation · Australia", [headline])];
    const citations = new Map([[citationKey("the-conversation:au", "tc"), "C1"]]);
    expect(selectBalancedEvidence(results, citations)).toEqual([]);
  });

  it("never sends title-only Crossref literature metadata to the discussion summarizer", () => {
    const literature = { ...evidence("paper", "Crossref", "", "crossref"), transientPreview: undefined, evidenceClass: "research literature" as const };
    const results = [result("crossref", "Crossref research literature", [literature])];
    const citations = new Map([[citationKey("crossref", "paper"), "C1"]]);
    expect(selectBalancedEvidence(results, citations)).toEqual([]);
  });

  it("keeps licensed Stack Exchange answer excerpts visible as evidence but excludes them from AI summaries", () => {
    const answer = {
      ...evidence("answer", "Economics Stack Exchange", "Inflation expectations can lift nominal bond yields.", "stack-exchange"),
      title: "Expert answer · question #7",
      evidenceClass: "expert Q&A" as const,
      summaryEligible: false,
    };
    const results = [result("stack-exchange:economics", "Economics Stack Exchange", [answer])];
    expect(results[0].evidence).toContain(answer);
    expect(selectBalancedEvidence(results, new Map([[citationKey(results[0].key, answer.id), "C1"]]))).toEqual([]);
  });


  it("collapses exact copies within one source operator but retains distinct wording", () => {
    const results = [result("one", "Lemmy A", [evidence("a", "Lemmy A", "same words", "lemmy-federation")]), result("two", "Lemmy B", [
      evidence("b", "Lemmy B", " SAME   WORDS ", "lemmy-federation"),
      evidence("c", "Lemmy B", "similar but not identical", "lemmy-federation"),
    ])];
    const citations = new Map([
      [citationKey("one", "a"), "C1"], [citationKey("two", "b"), "C2"], [citationKey("two", "c"), "C3"],
    ]);
    expect(selectBalancedEvidence(results, citations).map(({ citationId }) => citationId)).toEqual(["C1", "C3"]);
  });

  it("does not send a repeated post as evidence for both sides of a comparison", () => {
    const shared = evidence("a", "Bluesky", "same post", "bluesky");
    const base = result("base", "Bluesky", [shared]);
    const local = result("local", "Bluesky", [{ ...shared, id: "b" }]);
    const citations = new Map([[citationKey("base", "a"), "C1"], [citationKey("local", "b"), "C2"]]);
    const selectedKeys = new Set<string>();
    const firstSide = selectBalancedEvidence([base], citations, 8, selectedKeys);
    const secondSide = selectBalancedEvidence([local], citations, 8, selectedKeys);
    expect(firstSide.map(({ citationId }) => citationId)).toEqual(["C1"]);
    expect(secondSide).toEqual([]);
  });

  it("accepts only citations present in the corresponding submitted evidence group", () => {
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "The English-language records mention supply constraints.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "Market supply constraints were noted." }] }],
      localClaims: [{ text: "The selected-language records discuss prices.", citations: ["C2"], supportingQuotes: [{ citationId: "C2", quote: "선택된 기록은 가격을 논의했다." }] }],
      comparisonClaims: [{ text: "These samples are not directly comparable.", citations: ["C1", "C2"], supportingQuotes: [
        { citationId: "C1", quote: "Market supply constraints were noted." },
        { citationId: "C2", quote: "선택된 기록은 가격을 논의했다." },
      ] }],
      limitations: ["Not representative"],
    }, {
      us: new Set(["C1"]), local: new Set(["C2"]),
      evidenceText: { us: new Map([["C1", "Market supply constraints were noted."]]), local: new Map([["C2", "선택된 기록은 가격을 논의했다."]]) },
    });
    expect(summary?.usSummary.citations).toEqual(["C1"]);
    expect(summary?.comparison.citations).toEqual(["C1", "C2"]);
    expect(summary?.comparison.supportingQuotes?.map(({ citationId }) => citationId)).toEqual(["C1", "C2"]);
  });

  it.each([
    ["invented alongside valid", ["C1", "C99"], "citation-unknown"],
    ["wrong group alongside valid", ["C1", "C2"], "citation-unknown"],
    ["duplicate", ["C1", "C1"], "citation-list"],
    ["non-string", ["C1", 1], "citation-list"],
    ["empty", [], "citation-list"],
    ["oversized", Array.from({ length: 9 }, (_, index) => `C${index + 1}`), "citation-list"],
  ])("rejects the complete claim for %s citations instead of silently repairing it", (_description, citations, code) => {
    const invalid = vi.fn();
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "One retrieved post describes uncertain supply.", citations }], localClaims: [], comparisonClaims: [],
    }, { us: new Set(["C1"]), local: new Set(["C2"]) }, invalid);
    expect(summary).toBeNull();
    expect(invalid).toHaveBeenCalledExactlyOnceWith({ code, group: "baselineClaims" });
  });

  it("rejects an overlong claim rather than truncating away a qualification", () => {
    const invalid = vi.fn();
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "One retrieved post says supply is tight.".padEnd(400, " ") + "However, the same source disputes that interpretation.", citations: ["C1"] }],
      localClaims: [], comparisonClaims: [],
    }, { us: new Set(["C1"]), local: new Set() }, invalid);
    expect(summary).toBeNull();
    expect(invalid).toHaveBeenCalledExactlyOnceWith({ code: "claim-length", group: "baselineClaims" });
  });

  it("reports only bounded diagnostic codes, never submitted excerpts or model text", () => {
    const invalid = vi.fn();
    normalizeMarketSummary({
      baselineClaims: [{ text: "One retrieved post describes uncertain supply.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "Invented private-to-this-test material." }] }],
      localClaims: [], comparisonClaims: [],
    }, { us: new Set(["C1"]), local: new Set(), evidenceText: { us: new Map([["C1", "Market supply remains uncertain."]]), local: new Map() } }, invalid);
    expect(invalid).toHaveBeenCalledExactlyOnceWith({ code: "quote-not-exact", group: "baselineClaims" });
    expect(JSON.stringify(invalid.mock.calls)).not.toContain("material");
    expect(JSON.stringify(invalid.mock.calls)).not.toContain("supply");
  });

  it("requires one exact excerpt substring for each AI citation and rejects cross-source quote swaps", () => {
    const evidenceText = {
      us: new Map([["C1", "Semiconductor demand may rise as supply tightens this quarter."]]),
      local: new Map([["C2", "반도체 수요와 가격은 불확실하다."]]),
    };
    const valid = normalizeMarketSummary({
      baselineClaims: [{ text: "One retrieved post says demand may rise.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "demand may rise as supply tightens" }] }],
      localClaims: [{ text: "One retrieved post describes uncertainty.", citations: ["C2"], supportingQuotes: [{ citationId: "C2", quote: "수요와 가격은 불확실하다" }] }],
      comparisonClaims: [{ text: "The excerpts frame demand differently.", citations: ["C1", "C2"], supportingQuotes: [
        { citationId: "C1", quote: "demand may rise as supply tightens" },
        { citationId: "C2", quote: "수요와 가격은 불확실하다" },
      ] }],
    }, { us: new Set(["C1"]), local: new Set(["C2"]), evidenceText });
    expect(valid?.localSummary.supportingQuotes?.[0].quote).toBe("수요와 가격은 불확실하다");

    const noQuote = normalizeMarketSummary({
      baselineClaims: [{ text: "Demand is rising.", citations: ["C1"] }], localClaims: [], comparisonClaims: [],
    }, { us: new Set(["C1"]), local: new Set(), evidenceText });
    expect(noQuote).toBeNull();

    const wrongSource = normalizeMarketSummary({
      baselineClaims: [{ text: "Demand is rising.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "수요와 가격은 불확실하다" }] }],
      localClaims: [], comparisonClaims: [],
    }, { us: new Set(["C1"]), local: new Set(), evidenceText });
    expect(wrongSource).toBeNull();
  });

  it("allows a short source sentence but rejects an overview that pastes a long supporting quote", () => {
    const shortExcerpt = "Semiconductor demand is slowing as supply adjusts.";
    const shortSummary = normalizeMarketSummary({
      baselineClaims: [{ text: shortExcerpt, citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: shortExcerpt }] }],
      localClaims: [], comparisonClaims: [],
    }, {
      us: new Set(["C1"]), local: new Set(),
      evidenceText: { us: new Map([["C1", shortExcerpt]]), local: new Map() },
    });
    expect(shortSummary).not.toBeNull();

    const excerpt = "Semiconductor demand is slowing as inventory builds this quarter, while manufacturers report longer lead times and uncertainty about pricing through the next planning cycle.";
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: `The cited post says: ${excerpt}`, citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: excerpt }] }],
      localClaims: [], comparisonClaims: [],
    }, {
      us: new Set(["C1"]), local: new Set(),
      evidenceText: { us: new Map([["C1", excerpt]]), local: new Map() },
    });
    expect(summary).toBeNull();

    const shortQuoteLongCopy = normalizeMarketSummary({
      baselineClaims: [{ text: excerpt, citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "Semiconductor demand" }] }],
      localClaims: [], comparisonClaims: [],
    }, {
      us: new Set(["C1"]), local: new Set(),
      evidenceText: { us: new Map([["C1", excerpt]]), local: new Map() },
    });
    expect(shortQuoteLongCopy).toBeNull();
  });

  it("rejects generated email addresses and social handles", () => {
    const evidenceText = { us: new Map([["C1", "Semiconductor demand may slow this quarter."]]), local: new Map<string, string>() };
    const makeSummary = (text: string) => normalizeMarketSummary({
      baselineClaims: [{ text, citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "Semiconductor demand may slow" }] }],
      localClaims: [], comparisonClaims: [],
    }, { us: new Set(["C1"]), local: new Set(), evidenceText });
    expect(makeSummary("@invented_handle says demand may slow.")).toBeNull();
    expect(makeSummary("analyst@example.org says demand may slow.")).toBeNull();
  });

  it("attributes model prose as unverified and rejects numeric details absent from cited text", () => {
    const valid = normalizeMarketSummary({
      baselineClaims: [
        { text: "One unverified retrieved post claims a silicon wafer demand score of 65.6; AI chip demand remains strong.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "silicon wafer demand score of 65.6. AI chip demand remains strong." }] },
      ],
      localClaims: [], comparisonClaims: [],
    }, {
      us: new Set(["C1"]), local: new Set(),
      evidenceText: { us: new Map([["C1", "Materials update (2026-08): silicon wafer demand score of 65.6. AI chip demand remains strong."]]), local: new Map() },
    });
    expect(valid?.usSummary.text).toContain("One unverified retrieved post claims");
    expect(valid?.usSummary.text).toContain("One unverified retrieved post claims a silicon wafer demand score of 65.6; AI chip demand remains strong.");

    const unattributedNumber = normalizeMarketSummary({
      baselineClaims: [{ text: "Trade statistics show silicon wafer demand score 65.6 in 2026-08.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "silicon wafer demand score 65.6." }] }],
      localClaims: [], comparisonClaims: [],
    }, {
      us: new Set(["C1"]), local: new Set(),
      evidenceText: { us: new Map([["C1", "Materials update (2026-08): silicon wafer demand score 65.6."]]), local: new Map() },
    });
    expect(unattributedNumber?.usSummary.text).toContain("One cited social post makes this unverified claim:");

    const unsupportedNumber = normalizeMarketSummary({
      baselineClaims: [{ text: "Silicon wafer demand score was 66.5 in 2026-08.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "silicon wafer demand score 65.6." }] }],
      localClaims: [], comparisonClaims: [],
    }, {
      us: new Set(["C1"]), local: new Set(),
      evidenceText: { us: new Map([["C1", "Materials update (2026-08): silicon wafer demand score 65.6."]]), local: new Map() },
    });
    expect(unsupportedNumber).toBeNull();
  });

  it("uses deterministic non-claiming text for a side with no submitted evidence", () => {
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "Investors universally expect growth.", citations: ["C1"] }],
      localClaims: [{ text: "Local view", citations: ["C2"] }],
      comparisonClaims: [{ text: "The two groups disagree.", citations: ["C2"] }],
      limitations: [],
    }, { us: new Set(), local: new Set(["C2"]) });
    expect(summary?.usSummary.text).toContain("No text-bearing records were submitted");
    expect(summary?.usSummary.text).toContain("baseline overview");
    expect(summary?.comparison.text).toContain("comparison is not available");
    expect(summary?.comparison.citations).toEqual(["C2"]);
  });

  it("rejects unsupported or uncited passages when evidence was supplied", () => {
    const value = {
      baselineClaims: [{ text: "The sample proves investors are bullish.", citations: [] }],
      localClaims: [], comparisonClaims: [], limitations: [],
    };
    expect(normalizeMarketSummary(value, { us: new Set(["C1"]), local: new Set() })).toBeNull();
  });

  it("rejects multiple claims instead of flattening them into one passage", () => {
    const summary = normalizeMarketSummary({
      baselineClaims: [
        { text: "One sourced claim.", citations: ["C1"] },
        { text: "A second sourced claim.", citations: ["C1"] },
      ],
      localClaims: [{ text: "Local evidence.", citations: ["C2"] }],
      comparisonClaims: [{ text: "Comparison.", citations: ["C1", "C2"] }],
      limitations: [],
    }, { us: new Set(["C1"]), local: new Set(["C2"]) });
    expect(summary).toBeNull();
  });

  it("limits claim count and rejects cross-group citations on side-specific views", () => {
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "Wrong side citation.", citations: ["C2"] }],
      localClaims: [{ text: "Local evidence.", citations: ["C2"] }],
      comparisonClaims: [{ text: "Comparison.", citations: ["C1", "C2"] }],
      limitations: [],
    }, { us: new Set(["C1"]), local: new Set(["C2"]) });
    expect(summary).toBeNull();
  });

  it("rejects multiple sentences hidden under one claim citation", () => {
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "The sample mentions demand. It also alleges a supply shortage.", citations: ["C1"] }],
      localClaims: [{ text: "Local evidence.", citations: ["C2"] }],
      comparisonClaims: [{ text: "The samples differ.", citations: ["C1", "C2"] }],
    }, { us: new Set(["C1"]), local: new Set(["C2"]) });
    expect(summary).toBeNull();
  });

  it("requires each comparison claim to cite both submitted evidence groups", () => {
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "Baseline evidence.", citations: ["C1"] }],
      localClaims: [{ text: "Selected-lens evidence.", citations: ["C2"] }],
      comparisonClaims: [{ text: "The samples diverge.", citations: ["C1"] }],
    }, { us: new Set(["C1"]), local: new Set(["C2"]) });
    expect(summary).toBeNull();
  });

  it("does not accept uncited model-authored limitations", () => {
    const summary = normalizeMarketSummary({
      baselineClaims: [{ text: "Baseline evidence.", citations: ["C1"] }],
      localClaims: [{ text: "Selected-lens evidence.", citations: ["C2"] }],
      comparisonClaims: [{ text: "The samples differ.", citations: ["C1", "C2"] }],
      limitations: ["Unsupported claim about the data collection."],
    }, { us: new Set(["C1"]), local: new Set(["C2"]) });
    expect(summary?.limitations).toEqual([]);
  });
});
