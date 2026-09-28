-- ============================================================
-- FeedOmeter: 25 Curated Publishers Seed Script for Cloudflare D1
-- Database: feedometer-db
-- Target Table: publishers
-- ============================================================

INSERT OR IGNORE INTO publishers (domain, name, category, bg_color, description, is_popular, popularity_rank) VALUES
('bbc.co.uk', 'BBC News', 'World News', '#bb1919', 'British Broadcasting Corporation', 1, 1),
('nytimes.com', 'NY Times', 'World News', '#111827', 'The New York Times', 1, 2),
('theguardian.com', 'The Guardian', 'World News', '#052962', 'Independent Global Journalism', 1, 3),
('skysports.com', 'Sky Sports', 'Sports', '#0b1e42', 'Live Sports & Breaking Updates', 1, 4),
('cnn.com', 'CNN', 'World News', '#cc0000', 'Cable News Network', 1, 5),
('npr.org', 'NPR News', 'World News', '#23588f', 'National Public Radio', 1, 6),
('aljazeera.com', 'Al Jazeera', 'World News', '#91530e', 'Global News Network', 1, 7),
('theverge.com', 'The Verge', 'Tech & AI', '#e5127d', 'Tech, Science, Art & Modern Culture', 1, 8),
('techcrunch.com', 'TechCrunch', 'Startups & VC', '#029e4b', 'Startup Ecosystem & Venture Capital', 1, 9),
('wired.com', 'Wired', 'Deep Tech', '#111827', 'The Future As It Happens', 1, 10),
('news.ycombinator.com', 'Hacker News', 'Developer', '#ff6600', 'Y Combinator Tech & Hacker Community', 1, 11),
('arstechnica.com', 'Ars Technica', 'Engineering', '#ff4e00', 'Original Technica & Science Reporting', 1, 12),
('technologyreview.com', 'MIT Tech', 'AI & Research', '#111827', 'Massachusetts Institute of Technology', 1, 13),
('engadget.com', 'Engadget', 'Gadgets', '#0066cc', 'Consumer Electronics & Gear Reviews', 1, 14),
('wsj.com', 'WSJ Markets', 'Finance', '#002f6c', 'The Wall Street Journal', 1, 15),
('bloomberg.com', 'Bloomberg', 'Finance', '#142542', 'Global Business & Financial Intelligence', 1, 16),
('forbes.com', 'Forbes', 'Business', '#111827', 'Business, Wealth & Entrepreneurship', 1, 17),
('ft.com', 'FT News', 'Global Economy', '#e07a5f', 'Financial Times Global News', 1, 18),
('fastcompany.com', 'Fast Company', 'Innovation', '#111827', 'Progressive Business, Design & Work', 1, 19),
('nasa.gov', 'NASA', 'Space', '#0b3d91', 'National Aeronautics and Space Admin', 1, 20),
('sciencedaily.com', 'ScienceDaily', 'Science', '#1b6ca8', 'Peer-Reviewed Science Research', 1, 21),
('nature.com', 'Nature', 'Research', '#105b8c', 'International Journal of Science', 1, 22),
('insideevs.com', 'InsideEVs', 'EV News', '#0284c7', 'Electric Vehicle News, Reviews & Charging', 1, 23),
('ign.com', 'IGN', 'Gaming', '#bf1313', 'Video Games, Reviews & Entertainment', 1, 24),
('polygon.com', 'Polygon', 'Gaming', '#e5127d', 'Gaming Culture, Anime & Entertainment', 1, 25);
