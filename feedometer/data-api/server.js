/**
 * FeedOmeter 2.1 — Data API Service Layer
 * Centralized Domain Services, SQL Server Express Integration, and Edge Security
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPool, query } = require('./config/db');
const { optionalAuth } = require('./middleware/authMiddleware');
const ArticleService = require('./services/ArticleService');

// Import Route Controllers
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const feedRoutes = require('./routes/feedRoutes');
const articleRoutes = require('./routes/articleRoutes');
const searchRoutes = require('./routes/searchRoutes');
const folderRoutes = require('./routes/folderRoutes');
const watchlistRoutes = require('./routes/watchlistRoutes');
const alertRoutes = require('./routes/alertRoutes');
const builderRoutes = require('./routes/builderRoutes');
const integrationRoutes = require('./routes/integrationRoutes');
const filterRoutes = require('./routes/filterRoutes');
const adminRoutes = require('./routes/adminRoutes');
const rssReaderRoutes = require('./routes/rssReaderRoutes');
const feedPreviewRoutes = require('./routes/feedPreviewRoutes');
const { getPersonalStream, getStreamForSources } = require('./services/PersonalStreamService');
const otherSourceDiscoveryRoutes = require('./plugins/other-source-discovery/routes');

const app = express();
const PORT = process.env.PORT || 8787;

// Configure CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8787',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:8787',
  process.env.APP_ORIGIN
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.filter(Boolean).includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Secret', 'X-API-Key', 'X-User-Id', 'X-User-Role']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request Logger (Development)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check endpoint
app.get(['/health', '/api/health'], async (req, res) => {
  try {
    const dbTest = await query('SELECT @@SERVERNAME AS [server], DB_NAME() AS [db], SYSUTCDATETIME() AS [utc_time]');
    const dbInfo = dbTest.recordset ? dbTest.recordset[0] : null;
    res.json({
      status: 'healthy',
      version: '2.1.0',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        server: dbInfo ? dbInfo.server : 'unknown',
        name: dbInfo ? dbInfo.db : 'unknown',
        server_utc: dbInfo ? dbInfo.utc_time : null
      }
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      version: '2.1.0',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: err.message
      }
    });
  }
});

// Mount Routes
const apiRouter = express.Router();
// The public RSS Reader keeps its SQL-compatible `/api/view` contract. Feed
// retrieval is delegated to the current Cloudflare KV Worker; no D1 is used.
apiRouter.use('/', rssReaderRoutes);
apiRouter.use('/', feedPreviewRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/feeds', feedRoutes);
apiRouter.use('/subscriptions', feedRoutes);
apiRouter.use('/catalog', feedRoutes);
apiRouter.use('/discovery/other-sources', otherSourceDiscoveryRoutes);
apiRouter.use('/articles', articleRoutes);
apiRouter.use('/', searchRoutes);
apiRouter.use('/folders', folderRoutes);
apiRouter.use('/', watchlistRoutes);
apiRouter.use('/', alertRoutes);
apiRouter.use('/', builderRoutes);
apiRouter.use('/', integrationRoutes);
apiRouter.use('/', filterRoutes);
apiRouter.use('/admin', adminRoutes);

// Compatibility mounts retain the browser application's established public
// paths while all persistence is served by SQL Server.
apiRouter.use('/', feedRoutes);

// Stream endpoint (GET /api/stream)
apiRouter.get('/stream', optionalAuth, async (req, res) => {
  try {
    const { folder_id, folderId, channel, urls, limit = 50, offset = 0, search } = req.query;
    const userId = req.user ? req.user.id : null;

    const streamLimit = Math.min(Number(limit) || 50, 100);
    // The signed-in digest is personal by definition: it resolves sources
    // through dbo.user_feeds, then reads those feeds live. SQL articles remain
    // available as a fallback only when live retrieval has no items.
    let articles = [];
    if (userId) {
      articles = await getPersonalStream(userId, { limit: streamLimit, folderId: folder_id || folderId });
      if (!articles.length) {
        articles = await ArticleService.getArticles({
          userId,
          followedOnly: true,
          folderId: folder_id || folderId,
          search,
          limit: streamLimit,
          offset: Number(offset) || 0
        });
      }
    } else if (urls) {
      // Guests receive a digest from only their browser-held followed URLs;
      // this is the guest counterpart of dbo.user_feeds, not a public feed list.
      const guestSources = String(urls).split(',').map((feed_url, index) => ({
        source_id: `guest_${index}`,
        feed_url: feed_url.trim(),
        title: 'RSS Feed',
        website_url: feed_url.trim(),
        category: 'General'
      })).filter((source) => /^https?:\/\//i.test(source.feed_url));
      articles = await getStreamForSources(guestSources, { limit: streamLimit });
    }

    res.json({
      status: 'success',
      success: true,
      items: articles,
      articles: articles,
      count: articles.length,
      stream_scope: userId ? 'personal' : (urls ? 'guest' : 'public')
    });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Mount under both /api and /api/v1 for compatibility
app.use('/api/v1', apiRouter);
app.use('/api', apiRouter);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, status: 'error', error: `Endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]', err);
  res.status(500).json({
    success: false,
    status: 'error',
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Initialize Database & Start Server
async function startServer() {
  try {
    console.log('[Data API] Initializing SQL Server Express connection pool...');
    await getPool();
    console.log('[Data API] Database pool verified.');
  } catch (err) {
    console.warn('[Data API Warning] Could not connect to SQL Server immediately. Will retry on first request:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`  🚀 FeedOmeter 2.1 Data API Layer running on http://localhost:${PORT}`);
    console.log(`  🔗 Health Check: http://localhost:${PORT}/health`);
    console.log(`  📦 14 Domain Services Loaded & Active`);
    console.log(`================================================================`);
  });
}

startServer();

module.exports = app;
