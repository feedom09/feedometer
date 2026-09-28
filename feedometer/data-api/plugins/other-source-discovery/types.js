const TYPES = [
  { id: 'youtube', label: 'YouTube channels and relevant recent videos' },
  { id: 'blogs', label: 'Blogs and publisher websites that do not expose an RSS feed' },
  { id: 'news', label: 'Recent news articles' },
  { id: 'newsletters', label: 'Newsletters/Substacks' },
  { id: 'research', label: 'Research papers or institutional sources' },
  { id: 'podcasts', label: 'Podcasts, where applicable' }
];
const byId = new Map(TYPES.map((item) => [item.id, item]));
module.exports = { TYPES, byId };
