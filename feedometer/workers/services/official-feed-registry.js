/**
 * Verified official feeds for publishers whose public site can be protected
 * while their syndication host remains intentionally accessible.
 *
 * This is not a replacement for the D1 catalog. It is a small, versioned
 * bootstrap registry shared by Add Source and Visual Builder so publisher
 * exceptions are not copied into each feature.
 */

const OFFICIAL_FEEDS = [
  {
    hosts: ['news.sky.com', 'skynews.com', 'www.skynews.com'],
    homepageCollection: {
      title: 'Sky News — All sections',
      description: 'Latest stories aggregated from Sky News official section feeds.',
      maxItems: 60
    },
    feeds: [
      { label: 'Top Stories', url: 'https://feeds.skynews.com/feeds/rss/home.xml' },
      { label: 'UK', url: 'https://feeds.skynews.com/feeds/rss/uk.xml' },
      { label: 'World', url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
      { label: 'Business', url: 'https://feeds.skynews.com/feeds/rss/business.xml' },
      { label: 'Technology', url: 'https://feeds.skynews.com/feeds/rss/technology.xml' },
      { label: 'Politics', url: 'https://feeds.skynews.com/feeds/rss/politics.xml' }
    ]
  },
  {
    hosts: ['bbc.com', 'www.bbc.com', 'bbc.co.uk', 'www.bbc.co.uk'],
    feeds: [
      { label: 'Top Stories', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
      { label: 'World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { label: 'UK', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
      { label: 'Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
      { label: 'Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' }
    ]
  }
];

function normalizedHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/** Returns immutable feed candidates so callers cannot alter the registry. */
export function getOfficialFeedCandidates(targetUrl) {
  let host = '';
  try {
    host = normalizedHost(new URL(targetUrl).hostname);
  } catch (_) {
    return [];
  }

  const matched = OFFICIAL_FEEDS.find((entry) =>
    entry.hosts.some((candidate) => normalizedHost(candidate) === host)
  );
  return matched ? matched.feeds.map((feed) => ({ ...feed, source: 'official_registry' })) : [];
}

/**
 * Returns a publisher-owned multi-section collection for a homepage when one
 * exists. This is intentionally distinct from a single official RSS feed: a
 * publisher homepage represents its current coverage, not one short section.
 */
export function getOfficialFeedCollection(targetUrl) {
  let host = '';
  try {
    host = normalizedHost(new URL(targetUrl).hostname);
  } catch (_) {
    return null;
  }

  const matched = OFFICIAL_FEEDS.find((entry) =>
    entry.hosts.some((candidate) => normalizedHost(candidate) === host)
  );
  if (!matched?.homepageCollection) return null;
  return {
    ...matched.homepageCollection,
    feeds: matched.feeds.map((feed) => ({ ...feed, source: 'official_registry' }))
  };
}
