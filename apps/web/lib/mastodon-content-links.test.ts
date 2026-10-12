import { describe, expect, it } from "vitest";
import { mastodonHasContentLink } from "./mastodon-content-links";

const tag = { name: "Solar", url: "https://mastodon.social/tags/solar" };
const anchor = '<a href="https://mastodon.social/tags/Solar" class="mention hashtag" rel="tag">#<span>Solar</span></a>';
const classify = (html: string, tags: unknown = [tag]) => mastodonHasContentLink(html, tags, "origin.example", "mastodon.social");

describe("Mastodon content-link classification", () => {
  it("does not mistake provider-confirmed hashtag navigation for article sharing", () => {
    expect(classify(`<p>Solar supply is constrained. ${anchor}</p>`)).toBe(false);
    expect(classify(anchor.replace("mastodon.social", "origin.example"))).toBe(false);
  });

  it("handles decoded entities, unquoted attributes and nested hashtag labels", () => {
    expect(classify('<a rel=tag class=hashtag href=https://mastodon.social/tags/solar>&#35;<span>Solar</span></a>')).toBe(false);
  });

  it("matches Unicode hashtag names without stripping combining marks", () => {
    const name = "महंगाई";
    const url = `https://mastodon.social/tags/${encodeURIComponent(name)}`;
    expect(classify(`<a href="${url}" class="hashtag" rel="tag">#${name}</a>`, [{ name, url }])).toBe(false);
  });

  it.each([
    '<a href="https://publisher.example/article">Report</a>',
    '<a class="hashtag" rel="tag" href="https://publisher.example/tags/solar">#Solar</a>',
    anchor.replace("/tags/Solar", "/article/Solar"),
    anchor.replace("/tags/Solar", "/tags/Solar?article=1"),
    anchor.replace("/tags/Solar", "/tags/Solar#article"),
    anchor.replace("mastodon.social", "mastodon.social.evil.example"),
    anchor.replace("https://mastodon.social", "https://user@mastodon.social"),
    anchor.replace("https://mastodon.social", "https://mastodon.social:8443"),
    anchor.replace("https://mastodon.social", "http://mastodon.social"),
    anchor.replace("https://mastodon.social", ""),
    anchor.replace('rel="tag"', 'rel="nofollow"'),
    anchor.replace('class="mention hashtag"', 'class="mention"'),
    anchor.replace("#<span>Solar</span>", "Solar demand report"),
    anchor.replace("#<span>Solar</span>", "#<span>OtherTag</span>"),
    '<a href="javascript:alert(1)">#Solar</a>',
  ])("keeps ambiguous, article and spoofed navigation links excluded: %s", (html) => {
    expect(classify(html)).toBe(true);
  });

  it.each([undefined, null, [], {}, [{ name: "Solar", url: "https://publisher.example/tags/solar" }]])(
    "does not trust hashtag CSS alone when provider tag metadata is missing or inconsistent", (tags) => {
      expect(mastodonHasContentLink(anchor, tags, "origin.example", "mastodon.social")).toBe(true);
    },
  );

  it.each(["https://publisher.example/report", "publisher.example/report", "https&#58;//publisher.example/report"])(
    "still detects text links beside valid hashtag navigation: %s", (link) => {
      expect(classify(`<p>${link} ${anchor}</p>`)).toBe(true);
    },
  );

  it("does not exempt an article link because the same post also has a valid hashtag", () => {
    expect(classify(`${anchor}<a href="https://publisher.example/report">read more</a>`)).toBe(true);
  });

  it("handles plain original commentary and fails closed for oversized HTML", () => {
    expect(classify("<p>Solar demand is weakening.</p>")).toBe(false);
    expect(classify("x".repeat(65_537))).toBe(true);
  });
});
