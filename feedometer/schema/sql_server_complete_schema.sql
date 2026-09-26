-- ==============================================================================
-- FEEDOMETER 2.1 / NEXT PHASE — COMPLETE SQL SERVER / AZURE SQL SCHEMA & INDEXES
-- Dialect: Microsoft T-SQL (Compatible with SQL Server 2016+, 2019, 2022, Express & Azure SQL)
-- Purpose: Complete enterprise relational schema with all clustered PKs, 
--          covering non-clustered indexes, and foreign key cascades.
-- ==============================================================================

USE master;
GO

-- 0. CREATE DATABASE (Uncomment if creating fresh database)
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'feedometer_db')
BEGIN
    CREATE DATABASE feedometer_db;
END
GO

USE feedometer_db;
GO

-- ==============================================================================
-- 1. CORE IDENTITY & AUTHENTICATION
-- ==============================================================================

-- USERS TABLE
IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_users PRIMARY KEY CLUSTERED,
        email NVARCHAR(255) NOT NULL,
        email_verified TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_users_email_verified CHECK (email_verified IN (0, 1)),
        first_name NVARCHAR(100) NULL,
        last_name NVARCHAR(100) NULL,
        display_name NVARCHAR(150) NOT NULL,
        dob VARCHAR(10) NULL,
        dob_locked TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_users_dob_locked CHECK (dob_locked IN (0, 1)),
        avatar_url NVARCHAR(500) NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'active' CONSTRAINT CK_users_status CHECK (status IN ('active', 'suspended', 'deleted')),
        [plan] NVARCHAR(20) NOT NULL DEFAULT 'free' CONSTRAINT CK_users_plan CHECK ([plan] IN ('free', 'pro', 'premium')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NULL,
        last_login BIGINT NULL,
        deleted_at BIGINT NULL
    );

    CREATE UNIQUE NONCLUSTERED INDEX idx_users_email ON dbo.users(email);
    CREATE NONCLUSTERED INDEX idx_users_status_created ON dbo.users(status, created_at DESC);
END
GO

-- AUTH PROVIDERS (Google OAuth, GitHub, Apple, Microsoft)
IF OBJECT_ID('dbo.user_auth_providers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_auth_providers (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_auth_providers PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uap_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        provider NVARCHAR(30) NOT NULL CONSTRAINT CK_uap_provider CHECK (provider IN ('google', 'apple', 'github', 'microsoft', 'saml')),
        provider_user_id NVARCHAR(255) NOT NULL,
        provider_email NVARCHAR(255) NULL,
        provider_metadata NVARCHAR(MAX) NULL,
        created_at BIGINT NOT NULL,
        CONSTRAINT UQ_uap_provider_uid UNIQUE (provider, provider_user_id)
    );

    CREATE NONCLUSTERED INDEX idx_providers_user ON dbo.user_auth_providers(user_id);
    CREATE NONCLUSTERED INDEX idx_providers_lookup ON dbo.user_auth_providers(provider, provider_user_id);
END
GO

-- PASSWORDS & LOCKOUTS
IF OBJECT_ID('dbo.user_passwords', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_passwords (
        user_id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_passwords PRIMARY KEY CLUSTERED CONSTRAINT FK_up_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        password_hash NVARCHAR(255) NOT NULL,
        password_changed_at BIGINT NOT NULL,
        failed_attempts INT NOT NULL DEFAULT 0,
        locked_until BIGINT NULL
    );
END
GO

-- MULTI-DEVICE SESSIONS
IF OBJECT_ID('dbo.user_sessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_sessions (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_sessions PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_us_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        token_hash NVARCHAR(64) NOT NULL,
        ip_address NVARCHAR(45) NULL,
        user_agent NVARCHAR(500) NULL,
        device_name NVARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_seen BIGINT NOT NULL
    );

    CREATE UNIQUE NONCLUSTERED INDEX idx_user_sessions_token ON dbo.user_sessions(token_hash) INCLUDE (user_id, expires_at);
    CREATE NONCLUSTERED INDEX idx_user_sessions_user ON dbo.user_sessions(user_id, expires_at DESC);
    CREATE NONCLUSTERED INDEX idx_user_sessions_created ON dbo.user_sessions(created_at DESC);
END
GO

-- EMAIL VERIFICATIONS
IF OBJECT_ID('dbo.email_verifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.email_verifications (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_email_verifications PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ev_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        token_hash NVARCHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL,
        used TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_ev_used CHECK (used IN (0, 1)),
        created_at BIGINT NOT NULL
    );

    CREATE UNIQUE NONCLUSTERED INDEX idx_ev_token ON dbo.email_verifications(token_hash);
    CREATE NONCLUSTERED INDEX idx_ev_user ON dbo.email_verifications(user_id);
END
GO

-- PASSWORD RESET TOKENS
IF OBJECT_ID('dbo.password_reset_tokens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.password_reset_tokens (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_password_reset_tokens PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_prt_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        token_hash NVARCHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL,
        used TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_prt_used CHECK (used IN (0, 1)),
        created_at BIGINT NOT NULL
    );

    CREATE UNIQUE NONCLUSTERED INDEX idx_prt_token ON dbo.password_reset_tokens(token_hash);
    CREATE NONCLUSTERED INDEX idx_prt_user ON dbo.password_reset_tokens(user_id);
END
GO

-- AUDIT & SECURITY LOGS
IF OBJECT_ID('dbo.user_audit_logs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_audit_logs (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_audit_logs PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NULL CONSTRAINT FK_ual_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE SET NULL,
        event_type NVARCHAR(100) NOT NULL,
        ip_address NVARCHAR(45) NULL,
        user_agent NVARCHAR(500) NULL,
        metadata NVARCHAR(MAX) NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_user_audit_logs_created ON dbo.user_audit_logs(created_at DESC);
    CREATE NONCLUSTERED INDEX idx_user_audit_logs_user ON dbo.user_audit_logs(user_id, created_at DESC);
END
GO

-- USER PREFERENCES
IF OBJECT_ID('dbo.user_preferences', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_preferences (
        user_id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_preferences PRIMARY KEY CLUSTERED CONSTRAINT FK_upref_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        theme NVARCHAR(20) NOT NULL DEFAULT 'system' CONSTRAINT CK_upref_theme CHECK (theme IN ('light', 'dark', 'system')),
        reading_mode NVARCHAR(20) NOT NULL DEFAULT 'cards' CONSTRAINT CK_upref_reading CHECK (reading_mode IN ('cards', 'split', 'compact')),
        font_size NVARCHAR(20) NOT NULL DEFAULT 'medium' CONSTRAINT CK_upref_font CHECK (font_size IN ('small', 'medium', 'large')),
        default_view NVARCHAR(50) NOT NULL DEFAULT 'home',
        timezone NVARCHAR(50) NOT NULL DEFAULT 'UTC',
        language NVARCHAR(20) NOT NULL DEFAULT 'en',
        date_format NVARCHAR(30) NOT NULL DEFAULT 'YYYY-MM-DD',
        email_notifications TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_upref_email_notif CHECK (email_notifications IN (0, 1)),
        auto_mark_read TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_upref_auto_read CHECK (auto_mark_read IN (0, 1)),
        updated_at BIGINT NOT NULL
    );
END
GO

-- NOTIFY SIGNUPS / WAITLIST
IF OBJECT_ID('dbo.notify_signups', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.notify_signups (
        email NVARCHAR(255) NOT NULL CONSTRAINT PK_notify_signups PRIMARY KEY CLUSTERED,
        joined_at NVARCHAR(50) NOT NULL,
        source NVARCHAR(100) NULL,
        country NVARCHAR(100) NULL,
        city NVARCHAR(100) NULL,
        synced_at NVARCHAR(50) NOT NULL
    );
END
GO

-- ==============================================================================
-- 2. PUBLISHERS, SOURCES & FEED LIFECYCLE
-- ==============================================================================

-- PUBLISHERS CATALOG
IF OBJECT_ID('dbo.publishers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.publishers (
        domain NVARCHAR(255) NOT NULL CONSTRAINT PK_publishers PRIMARY KEY CLUSTERED,
        name NVARCHAR(255) NOT NULL,
        category NVARCHAR(100) NOT NULL,
        bg_color NVARCHAR(30) NULL,
        description NVARCHAR(1000) NULL,
        logo_url NVARCHAR(1000) NULL,
        is_popular TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_pub_popular CHECK (is_popular IN (0, 1)),
        popularity_rank INT NULL
    );

    CREATE NONCLUSTERED INDEX idx_publishers_category ON dbo.publishers(category, is_popular DESC);
END
GO

-- SOURCES (FEEDS)
IF OBJECT_ID('dbo.sources', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.sources (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_sources PRIMARY KEY CLUSTERED,
        publisher_domain NVARCHAR(255) NULL CONSTRAINT FK_sources_publishers FOREIGN KEY REFERENCES dbo.publishers(domain) ON DELETE SET NULL,
        title NVARCHAR(255) NOT NULL,
        feed_url NVARCHAR(1000) NOT NULL,
        website_url NVARCHAR(1000) NULL,
        source_type NVARCHAR(30) NOT NULL DEFAULT 'rss' CONSTRAINT CK_sources_type CHECK (source_type IN ('rss', 'atom', 'youtube', 'reddit', 'amazon_deals', 'podcast', 'substack', 'custom')),
        feed_config NVARCHAR(MAX) NULL,
        category NVARCHAR(100) NOT NULL DEFAULT 'general',
        language NVARCHAR(20) NOT NULL DEFAULT 'en',
        logo_url NVARCHAR(1000) NULL,
        is_verified TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_sources_verified CHECK (is_verified IN (0, 1)),
        article_count INT NOT NULL DEFAULT 0,
        last_polled_at BIGINT NULL,
        last_article_at BIGINT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'active' CONSTRAINT CK_sources_status CHECK (status IN ('active', 'paused', 'failing'))
    );

    CREATE UNIQUE NONCLUSTERED INDEX idx_sources_feed_url ON dbo.sources(feed_url);
    CREATE NONCLUSTERED INDEX idx_sources_category ON dbo.sources(category, status);
    CREATE NONCLUSTERED INDEX idx_sources_status_polled ON dbo.sources(status, last_polled_at ASC);
    CREATE NONCLUSTERED INDEX idx_sources_publisher ON dbo.sources(publisher_domain);
END
GO

-- SOURCE LIFECYCLE (Backoff & State Machine)
IF OBJECT_ID('dbo.source_lifecycle', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.source_lifecycle (
        source_id NVARCHAR(64) NOT NULL CONSTRAINT PK_source_lifecycle PRIMARY KEY CLUSTERED CONSTRAINT FK_sl_sources FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        state NVARCHAR(30) NOT NULL DEFAULT 'pending' CONSTRAINT CK_sl_state CHECK (state IN ('pending', 'active', 'paused', 'degraded', 'failing', 'blocked')),
        is_user_paused TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_sl_user_paused CHECK (is_user_paused IN (0, 1)),
        consecutive_failures INT NOT NULL DEFAULT 0,
        last_attempt_at BIGINT NULL,
        last_success_at BIGINT NULL,
        last_failure_at BIGINT NULL,
        next_retry_at BIGINT NULL,
        last_error_code NVARCHAR(50) NULL,
        last_error_message NVARCHAR(1000) NULL,
        state_reason NVARCHAR(255) NULL,
        state_changed_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_sl_state_retry ON dbo.source_lifecycle(state, is_user_paused, next_retry_at);
END
GO

-- SOURCE HEALTH TELEMETRY
IF OBJECT_ID('dbo.source_health', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.source_health (
        source_id NVARCHAR(64) NOT NULL CONSTRAINT PK_source_health PRIMARY KEY CLUSTERED CONSTRAINT FK_sh_sources FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        last_success_at BIGINT NULL,
        last_failure_at BIGINT NULL,
        consecutive_failures INT NOT NULL DEFAULT 0,
        last_http_status INT NULL,
        response_ms INT NULL,
        error_message NVARCHAR(1000) NULL
    );
END
GO

-- FEED SUBMISSIONS (User Proposals)
IF OBJECT_ID('dbo.feed_submissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feed_submissions (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_feed_submissions PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NULL CONSTRAINT FK_fs_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE SET NULL,
        feed_url NVARCHAR(1000) NOT NULL,
        suggested_title NVARCHAR(255) NULL,
        suggested_category NVARCHAR(100) NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'pending' CONSTRAINT CK_fs_status CHECK (status IN ('pending', 'approved', 'rejected')),
        reviewed_at BIGINT NULL,
        reviewed_by NVARCHAR(64) NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_fs_status ON dbo.feed_submissions(status, created_at DESC);
    CREATE NONCLUSTERED INDEX idx_fs_user ON dbo.feed_submissions(user_id);
END
GO

-- ==============================================================================
-- 3. CONTENT CATALOG & ARTICLES
-- ==============================================================================

-- ARTICLES TABLE
IF OBJECT_ID('dbo.articles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.articles (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_articles PRIMARY KEY CLUSTERED,
        canonical_url_hash VARCHAR(64) NOT NULL,
        source_id NVARCHAR(64) NOT NULL CONSTRAINT FK_articles_sources FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        title NVARCHAR(500) NOT NULL,
        url NVARCHAR(1000) NOT NULL,
        author NVARCHAR(255) NULL,
        snippet NVARCHAR(1500) NULL,
        content NVARCHAR(MAX) NULL,
        image_url NVARCHAR(1000) NULL,
        published_at BIGINT NOT NULL,
        ingested_at BIGINT NOT NULL,
        is_pinned TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_articles_pinned CHECK (is_pinned IN (0, 1))
    );

    CREATE UNIQUE NONCLUSTERED INDEX idx_articles_hash ON dbo.articles(canonical_url_hash);
    CREATE NONCLUSTERED INDEX idx_articles_source_pub ON dbo.articles(source_id, published_at DESC);
    CREATE NONCLUSTERED INDEX idx_articles_published ON dbo.articles(published_at DESC) INCLUDE (title, url, image_url, source_id);
    CREATE NONCLUSTERED INDEX idx_articles_ingested ON dbo.articles(ingested_at DESC);
END
GO

-- ==============================================================================
-- 4. USER SUBSCRIPTIONS, FOLDERS & ACTIONS
-- ==============================================================================

-- FOLDERS TABLE
IF OBJECT_ID('dbo.folders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.folders (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_folders PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_folders_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(100) NOT NULL,
        parent_folder_id NVARCHAR(64) NULL CONSTRAINT FK_folders_parent FOREIGN KEY REFERENCES dbo.folders(id),
        icon NVARCHAR(30) NOT NULL DEFAULT '📁',
        sort_order INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_folders_user ON dbo.folders(user_id, parent_folder_id);
END
GO

-- USER FEEDS (Subscriptions)
IF OBJECT_ID('dbo.user_feeds', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_feeds (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_feeds PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uf_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        source_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uf_sources FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        followed_at BIGINT NOT NULL,
        CONSTRAINT UQ_user_feeds_user_source UNIQUE (user_id, source_id)
    );

    CREATE NONCLUSTERED INDEX idx_user_feeds_user ON dbo.user_feeds(user_id);
    CREATE NONCLUSTERED INDEX idx_user_feeds_source ON dbo.user_feeds(source_id);
END
GO

-- USER FEED ASSIGNMENTS (Folder Mapping)
IF OBJECT_ID('dbo.user_feed_assignments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_feed_assignments (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_feed_assignments PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ufa_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        feed_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ufa_sources FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        folder_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ufa_folders FOREIGN KEY REFERENCES dbo.folders(id),
        assigned_at BIGINT NOT NULL,
        CONSTRAINT UQ_ufa_user_feed_folder UNIQUE (user_id, feed_id, folder_id)
    );

    CREATE NONCLUSTERED INDEX idx_assignments_user ON dbo.user_feed_assignments(user_id, folder_id);
    CREATE NONCLUSTERED INDEX idx_assignments_feed ON dbo.user_feed_assignments(feed_id);
END
GO

-- STARRED ARTICLES
IF OBJECT_ID('dbo.starred_articles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.starred_articles (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_starred_articles PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_starred_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_starred_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE CASCADE,
        starred_at BIGINT NOT NULL,
        CONSTRAINT UQ_starred_user_article UNIQUE (user_id, article_id)
    );

    CREATE NONCLUSTERED INDEX idx_starred_user ON dbo.starred_articles(user_id, starred_at DESC);
    CREATE NONCLUSTERED INDEX idx_starred_article ON dbo.starred_articles(article_id);
END
GO

-- SAVED ARTICLES (Bookmarks)
IF OBJECT_ID('dbo.saved_articles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.saved_articles (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_saved_articles PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_saved_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_saved_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE CASCADE,
        saved_at BIGINT NOT NULL,
        CONSTRAINT UQ_saved_user_article UNIQUE (user_id, article_id)
    );

    CREATE NONCLUSTERED INDEX idx_saved_user ON dbo.saved_articles(user_id, saved_at DESC);
    CREATE NONCLUSTERED INDEX idx_saved_article ON dbo.saved_articles(article_id);
END
GO

-- READ HISTORY
IF OBJECT_ID('dbo.read_history', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.read_history (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_read_history PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_rh_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_rh_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE CASCADE,
        read_at BIGINT NOT NULL,
        CONSTRAINT UQ_read_history_user_article UNIQUE (user_id, article_id)
    );

    CREATE NONCLUSTERED INDEX idx_read_user ON dbo.read_history(user_id, read_at DESC);
    CREATE NONCLUSTERED INDEX idx_read_article ON dbo.read_history(article_id);
END
GO

-- ARTICLE ENGAGEMENT EVENTS
IF OBJECT_ID('dbo.article_events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.article_events (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_article_events PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NULL CONSTRAINT FK_ae_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE SET NULL,
        source_id NVARCHAR(64) NULL CONSTRAINT FK_ae_sources FOREIGN KEY REFERENCES dbo.sources(id),
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ae_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE CASCADE,
        event_type NVARCHAR(30) NOT NULL CONSTRAINT CK_ae_type CHECK (event_type IN ('VIEW', 'CLICK', 'READ_COMPLETE', 'STAR', 'SAVE', 'SHARE', 'OPEN_SOURCE')),
        dwell_time_ms INT NULL,
        ip_address NVARCHAR(45) NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_article_events_created ON dbo.article_events(created_at DESC);
    CREATE NONCLUSTERED INDEX idx_article_events_source ON dbo.article_events(source_id, created_at DESC);
    CREATE NONCLUSTERED INDEX idx_article_events_article ON dbo.article_events(article_id, event_type);
    CREATE NONCLUSTERED INDEX idx_article_events_user ON dbo.article_events(user_id, created_at DESC);
END
GO

-- ==============================================================================
-- 5. AUTOMATION, ALERTS, WEBHOOKS & DIGESTS
-- ==============================================================================

-- FEED EVENT INGESTION QUEUE
IF OBJECT_ID('dbo.feed_events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feed_events (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_feed_events PRIMARY KEY CLUSTERED,
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_fe_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE CASCADE,
        source_id NVARCHAR(64) NOT NULL CONSTRAINT FK_fe_sources FOREIGN KEY REFERENCES dbo.sources(id),
        event_type NVARCHAR(50) NOT NULL DEFAULT 'ARTICLE_INGESTED',
        status NVARCHAR(20) NOT NULL DEFAULT 'pending' CONSTRAINT CK_fe_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        locked_until BIGINT NOT NULL DEFAULT 0,
        retry_count INT NOT NULL DEFAULT 0,
        error_message NVARCHAR(1000) NULL,
        created_at BIGINT NOT NULL,
        processed_at BIGINT NULL
    );

    CREATE NONCLUSTERED INDEX idx_feed_events_queue ON dbo.feed_events(status, locked_until, created_at);
END
GO

-- USER ALERTS
IF OBJECT_ID('dbo.user_alerts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_alerts (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_alerts PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ua_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        alert_type NVARCHAR(30) NOT NULL DEFAULT 'keyword' CONSTRAINT CK_ua_type CHECK (alert_type IN ('keyword', 'collection', 'source', 'saved_search')),
        config_json NVARCHAR(MAX) NOT NULL,
        delivery_channels NVARCHAR(255) NOT NULL,
        is_active TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_ua_active CHECK (is_active IN (0, 1)),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NULL
    );

    CREATE NONCLUSTERED INDEX idx_user_alerts_user ON dbo.user_alerts(user_id, is_active);
END
GO

-- ALERT DELIVERIES OUTBOX
IF OBJECT_ID('dbo.alert_deliveries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.alert_deliveries (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_alert_deliveries PRIMARY KEY CLUSTERED,
        alert_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ad_alerts FOREIGN KEY REFERENCES dbo.user_alerts(id) ON DELETE CASCADE,
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ad_articles FOREIGN KEY REFERENCES dbo.articles(id),
        channel NVARCHAR(30) NOT NULL CONSTRAINT CK_ad_channel CHECK (channel IN ('in_app', 'push', 'email', 'telegram')),
        status NVARCHAR(20) NOT NULL DEFAULT 'pending' CONSTRAINT CK_ad_status CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
        attempt_count INT NOT NULL DEFAULT 0,
        locked_until BIGINT NOT NULL DEFAULT 0,
        sent_at BIGINT NULL,
        error_message NVARCHAR(1000) NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_alert_delivery_queue ON dbo.alert_deliveries(status, locked_until, created_at);
END
GO

-- WEB PUSH SUBSCRIPTIONS
IF OBJECT_ID('dbo.user_push_subscriptions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_push_subscriptions (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_push_subscriptions PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ups_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        endpoint NVARCHAR(1000) NOT NULL,
        p256dh NVARCHAR(255) NOT NULL,
        auth_key NVARCHAR(255) NOT NULL,
        user_agent NVARCHAR(500) NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_push_user ON dbo.user_push_subscriptions(user_id);
END
GO

-- USER WEBHOOKS
IF OBJECT_ID('dbo.user_webhooks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_webhooks (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_webhooks PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uw_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        target_url NVARCHAR(1000) NOT NULL,
        secret_key NVARCHAR(255) NOT NULL,
        config_json NVARCHAR(MAX) NULL,
        cadence NVARCHAR(20) NOT NULL DEFAULT 'realtime' CONSTRAINT CK_uw_cadence CHECK (cadence IN ('realtime', 'daily', 'weekly')),
        schedule_time NVARCHAR(10) NOT NULL DEFAULT '17:00',
        schedule_day NVARCHAR(20) NOT NULL DEFAULT 'monday',
        format_type NVARCHAR(20) NOT NULL DEFAULT 'standard' CONSTRAINT CK_uw_format CHECK (format_type IN ('standard', 'slack')),
        last_cursor_at BIGINT NOT NULL DEFAULT 0,
        next_run_at BIGINT NOT NULL DEFAULT 0,
        is_active TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_uw_active CHECK (is_active IN (0, 1)),
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_webhooks_user ON dbo.user_webhooks(user_id, is_active);
END
GO

-- WEBHOOK DELIVERIES OUTBOX
IF OBJECT_ID('dbo.webhook_deliveries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.webhook_deliveries (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_webhook_deliveries PRIMARY KEY CLUSTERED,
        webhook_id NVARCHAR(64) NOT NULL CONSTRAINT FK_wd_webhooks FOREIGN KEY REFERENCES dbo.user_webhooks(id) ON DELETE CASCADE,
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_wd_articles FOREIGN KEY REFERENCES dbo.articles(id),
        payload_json NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'pending' CONSTRAINT CK_wd_status CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
        attempt_count INT NOT NULL DEFAULT 0,
        locked_until BIGINT NOT NULL DEFAULT 0,
        response_code INT NULL,
        response_body NVARCHAR(MAX) NULL,
        duration_ms INT NULL,
        delivered_at BIGINT NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_webhook_delivery_queue ON dbo.webhook_deliveries(status, locked_until, created_at);
END
GO

-- SCHEDULED DIGESTS
IF OBJECT_ID('dbo.user_digests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_digests (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_digests PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ud_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        schedule_type NVARCHAR(20) NOT NULL CONSTRAINT CK_ud_schedule CHECK (schedule_type IN ('daily', 'weekly')),
        delivery_channel NVARCHAR(20) NOT NULL DEFAULT 'email' CONSTRAINT CK_ud_channel CHECK (delivery_channel IN ('email', 'in_app')),
        collection_ids NVARCHAR(MAX) NULL,
        config_json NVARCHAR(MAX) NULL,
        last_article_at BIGINT NOT NULL DEFAULT 0,
        last_run_at BIGINT NULL,
        next_run_at BIGINT NOT NULL,
        is_active TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_ud_active CHECK (is_active IN (0, 1)),
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_digest_schedule ON dbo.user_digests(is_active, next_run_at);
    CREATE NONCLUSTERED INDEX idx_digest_user ON dbo.user_digests(user_id);
END
GO

-- DIGEST RUNS LEDGER
IF OBJECT_ID('dbo.digest_runs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.digest_runs (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_digest_runs PRIMARY KEY CLUSTERED,
        digest_id NVARCHAR(64) NOT NULL CONSTRAINT FK_dr_digests FOREIGN KEY REFERENCES dbo.user_digests(id) ON DELETE CASCADE,
        article_count INT NOT NULL DEFAULT 0,
        status NVARCHAR(30) NOT NULL DEFAULT 'completed',
        sent_to NVARCHAR(255) NULL,
        started_at BIGINT NOT NULL,
        completed_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_digest_runs_digest ON dbo.digest_runs(digest_id, started_at DESC);
END
GO

-- ==============================================================================
-- 6. SEARCH, KEYWORD ALERTS & FILTERS
-- ==============================================================================

-- SAVED SEARCHES
IF OBJECT_ID('dbo.saved_searches', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.saved_searches (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_saved_searches PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ss_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        search_query NVARCHAR(500) NOT NULL,
        filters_json NVARCHAR(MAX) NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        last_used_at BIGINT NULL
    );

    CREATE NONCLUSTERED INDEX idx_saved_searches_user ON dbo.saved_searches(user_id, created_at DESC);
END
GO

-- KEYWORD ALERTS (In-App & Legacy Trackers)
IF OBJECT_ID('dbo.keyword_alerts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.keyword_alerts (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_keyword_alerts PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ka_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        keyword NVARCHAR(255) NOT NULL,
        is_active TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_ka_active CHECK (is_active IN (0, 1)),
        notification_channel NVARCHAR(30) NOT NULL DEFAULT 'in_app',
        last_notified_at BIGINT NULL,
        match_count INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_keyword_alerts_active ON dbo.keyword_alerts(is_active, notification_channel, last_notified_at);
    CREATE NONCLUSTERED INDEX idx_keyword_alerts_user ON dbo.keyword_alerts(user_id);
END
GO

-- USER FILTER RULES
IF OBJECT_ID('dbo.user_filter_rules', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_filter_rules (
        user_id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_filter_rules PRIMARY KEY CLUSTERED CONSTRAINT FK_ufr_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        rules_json NVARCHAR(MAX) NOT NULL,
        updated_at BIGINT NOT NULL
    );
END
GO

-- SEARCH SUGGESTIONS
IF OBJECT_ID('dbo.search_suggestions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.search_suggestions (
        term NVARCHAR(255) NOT NULL CONSTRAINT PK_search_suggestions PRIMARY KEY CLUSTERED,
        search_count INT NOT NULL DEFAULT 0,
        click_count INT NOT NULL DEFAULT 0,
        updated_at BIGINT NULL
    );
END
GO

-- SEARCH QUERIES
IF OBJECT_ID('dbo.search_queries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.search_queries (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_search_queries PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NULL CONSTRAINT FK_sq_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE SET NULL,
        query NVARCHAR(500) NOT NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_search_queries_created ON dbo.search_queries(created_at DESC);
END
GO

-- SEARCH CLICKS
IF OBJECT_ID('dbo.search_clicks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.search_clicks (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_search_clicks PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NULL CONSTRAINT FK_sc_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE SET NULL,
        article_id NVARCHAR(64) NULL CONSTRAINT FK_sc_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE SET NULL,
        query NVARCHAR(500) NULL,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_search_clicks_created ON dbo.search_clicks(created_at DESC);
END
GO

-- ==============================================================================
-- 7. VISUAL BUILDER, DOMAIN PATTERNS & BUNDLES
-- ==============================================================================

-- BUILDER CONFIGS
IF OBJECT_ID('dbo.feed_builder_configs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feed_builder_configs (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_feed_builder_configs PRIMARY KEY CLUSTERED,
        source_id NVARCHAR(64) NOT NULL CONSTRAINT FK_fbc_sources FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        content_type NVARCHAR(30) NOT NULL DEFAULT 'news' CONSTRAINT CK_fbc_type CHECK (content_type IN ('news', 'blog', 'ecommerce', 'generic')),
        render_js TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_fbc_render CHECK (render_js IN (0, 1)),
        extraction_mode NVARCHAR(30) NOT NULL DEFAULT 'auto' CONSTRAINT CK_fbc_mode CHECK (extraction_mode IN ('auto', 'manual', 'llm_semantic')),
        selector_config_json NVARCHAR(MAX) NOT NULL,
        confidence_json NVARCHAR(MAX) NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_builder_source ON dbo.feed_builder_configs(source_id);
END
GO

-- FEED HEALTH METRICS
IF OBJECT_ID('dbo.feed_health_metrics', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feed_health_metrics (
        source_id NVARCHAR(64) NOT NULL CONSTRAINT PK_feed_health_metrics PRIMARY KEY CLUSTERED CONSTRAINT FK_fhm_sources FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        health_score INT NOT NULL DEFAULT 100 CONSTRAINT CK_fhm_score CHECK (health_score BETWEEN 0 AND 100),
        field_health_json NVARCHAR(MAX) NOT NULL DEFAULT '{}',
        item_count_baseline INT NOT NULL DEFAULT 15,
        last_item_count INT NOT NULL DEFAULT 0,
        last_drift_detected_at BIGINT NULL,
        last_healed_at BIGINT NULL,
        recorded_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_health_score ON dbo.feed_health_metrics(health_score);
END
GO

-- DOMAIN PATTERNS (Selector Learning Layer)
IF OBJECT_ID('dbo.domain_patterns', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.domain_patterns (
        domain NVARCHAR(255) NOT NULL CONSTRAINT PK_domain_patterns PRIMARY KEY CLUSTERED,
        selector_config_json NVARCHAR(MAX) NOT NULL,
        confidence FLOAT NOT NULL DEFAULT 0.95,
        [source] NVARCHAR(30) NOT NULL DEFAULT 'auto' CONSTRAINT CK_dp_source CHECK ([source] IN ('auto', 'user_correction', 'llm')),
        usage_count INT NOT NULL DEFAULT 1,
        updated_at BIGINT NOT NULL
    );
END
GO

-- FEED BUNDLES
IF OBJECT_ID('dbo.feed_bundles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feed_bundles (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_feed_bundles PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_fb_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        slug NVARCHAR(255) NOT NULL CONSTRAINT UQ_fb_slug UNIQUE,
        description NVARCHAR(1000) NULL,
        feed_ids_json NVARCHAR(MAX) NOT NULL,
        is_public TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_fb_public CHECK (is_public IN (0, 1)),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_bundles_user ON dbo.feed_bundles(user_id);
END
GO

-- ==============================================================================
-- 8. INTEGRATIONS & DEVELOPER API KEYS
-- ==============================================================================

-- INTEGRATIONS CATALOG
IF OBJECT_ID('dbo.integrations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.integrations (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_integrations PRIMARY KEY CLUSTERED,
        code NVARCHAR(50) NOT NULL CONSTRAINT UQ_integrations_code UNIQUE,
        name NVARCHAR(100) NOT NULL,
        category NVARCHAR(50) NOT NULL,
        icon NVARCHAR(30) NOT NULL,
        logo_url NVARCHAR(1000) NULL,
        description NVARCHAR(1000) NOT NULL,
        badge NVARCHAR(50) NULL,
        setup_type NVARCHAR(30) NOT NULL DEFAULT 'webhook',
        is_active TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_int_active CHECK (is_active IN (0, 1)),
        display_order INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
    );
END
GO

-- USER CONNECTED INTEGRATIONS
IF OBJECT_ID('dbo.user_integrations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_integrations (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_integrations PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uint_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        integration_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uint_integrations FOREIGN KEY REFERENCES dbo.integrations(id),
        name NVARCHAR(255) NOT NULL,
        config_json NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'active' CONSTRAINT CK_uint_status CHECK (status IN ('active', 'disabled', 'error')),
        last_used_at BIGINT NULL,
        last_error NVARCHAR(1000) NULL,
        connected_at BIGINT NOT NULL,
        updated_at BIGINT NULL
    );

    CREATE NONCLUSTERED INDEX idx_user_integrations_user ON dbo.user_integrations(user_id, integration_id);
    CREATE NONCLUSTERED INDEX idx_user_integrations_status ON dbo.user_integrations(status);
END
GO

-- DEVELOPER API KEYS
IF OBJECT_ID('dbo.api_keys', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.api_keys (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_api_keys PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ak_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        key_prefix NVARCHAR(30) NOT NULL,
        key_suffix NVARCHAR(30) NOT NULL,
        key_hash NVARCHAR(64) NOT NULL CONSTRAINT UQ_ak_keyhash UNIQUE,
        permissions NVARCHAR(MAX) NOT NULL DEFAULT '["read:articles","read:sources","read:search","read:me"]',
        rate_limit_per_min INT NOT NULL DEFAULT 60,
        last_used_at BIGINT NULL,
        expires_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        revoked_at BIGINT NULL,
        is_active TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_ak_active CHECK (is_active IN (0, 1))
    );

    CREATE NONCLUSTERED INDEX idx_api_keys_lookup ON dbo.api_keys(key_hash, is_active);
    CREATE NONCLUSTERED INDEX idx_api_keys_user ON dbo.api_keys(user_id, is_active);
END
GO

-- ==============================================================================
-- 9. CURATION (TAGS & COLLECTIONS)
-- ==============================================================================

-- USER ARTICLE TAGS
IF OBJECT_ID('dbo.user_article_tags', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_article_tags (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_article_tags PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uat_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(100) NOT NULL,
        color NVARCHAR(30) NULL,
        created_at BIGINT NOT NULL,
        CONSTRAINT UQ_uat_user_name UNIQUE (user_id, name)
    );

    CREATE NONCLUSTERED INDEX idx_uat_user ON dbo.user_article_tags(user_id);
END
GO

-- ARTICLE TAG ASSIGNMENTS
IF OBJECT_ID('dbo.article_tag_assignments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.article_tag_assignments (
        user_id NVARCHAR(64) NOT NULL,
        article_id NVARCHAR(64) NOT NULL,
        tag_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ata_tags FOREIGN KEY REFERENCES dbo.user_article_tags(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        CONSTRAINT PK_article_tag_assignments PRIMARY KEY CLUSTERED (user_id, article_id, tag_id)
    );

    CREATE NONCLUSTERED INDEX idx_article_tag_assignments_tag ON dbo.article_tag_assignments(user_id, tag_id, article_id);
END
GO

-- USER COLLECTIONS
IF OBJECT_ID('dbo.user_collections', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_collections (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_user_collections PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_uc_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        description NVARCHAR(1000) NULL,
        share_token NVARCHAR(64) NULL CONSTRAINT UQ_uc_share UNIQUE,
        is_public TINYINT NOT NULL DEFAULT 0 CONSTRAINT CK_uc_public CHECK (is_public IN (0, 1)),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NULL
    );

    CREATE NONCLUSTERED INDEX idx_collections_user ON dbo.user_collections(user_id, created_at DESC);
END
GO

-- COLLECTION ARTICLES
IF OBJECT_ID('dbo.collection_articles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.collection_articles (
        collection_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ca_collections FOREIGN KEY REFERENCES dbo.user_collections(id) ON DELETE CASCADE,
        article_id NVARCHAR(64) NOT NULL CONSTRAINT FK_ca_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE CASCADE,
        added_at BIGINT NOT NULL,
        CONSTRAINT PK_collection_articles PRIMARY KEY CLUSTERED (collection_id, article_id)
    );
END
GO

-- ==============================================================================
-- 10. AI ENRICHMENT & CLUSTERING FOUNDATION
-- ==============================================================================

-- AI SUMMARIES
IF OBJECT_ID('dbo.ai_article_summaries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ai_article_summaries (
        article_id NVARCHAR(64) NOT NULL CONSTRAINT PK_ai_article_summaries PRIMARY KEY CLUSTERED CONSTRAINT FK_ai_articles FOREIGN KEY REFERENCES dbo.articles(id) ON DELETE CASCADE,
        model NVARCHAR(100) NOT NULL,
        summary_json NVARCHAR(MAX) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
    );
END
GO

-- AI TOPIC CLUSTERS
IF OBJECT_ID('dbo.ai_topic_clusters', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ai_topic_clusters (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_ai_topic_clusters PRIMARY KEY CLUSTERED,
        label NVARCHAR(255) NOT NULL,
        fingerprint NVARCHAR(64) NOT NULL CONSTRAINT UQ_atc_fingerprint UNIQUE,
        article_count INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    );
END
GO

-- AI TRACKING RULES
IF OBJECT_ID('dbo.ai_tracking_rules', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ai_tracking_rules (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_ai_tracking_rules PRIMARY KEY CLUSTERED,
        user_id NVARCHAR(64) NOT NULL CONSTRAINT FK_aitr_users FOREIGN KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
        name NVARCHAR(255) NOT NULL,
        entities_json NVARCHAR(MAX) NOT NULL,
        is_active TINYINT NOT NULL DEFAULT 1 CONSTRAINT CK_aitr_active CHECK (is_active IN (0, 1)),
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_ai_tracking_user ON dbo.ai_tracking_rules(user_id);
END
GO

-- ==============================================================================
-- 11. FEED DISCOVERY & TOPIC GRAPH
-- ==============================================================================

-- DISCOVERY CACHE
IF OBJECT_ID('dbo.feed_discovery_cache', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feed_discovery_cache (
        normalized_query NVARCHAR(255) NOT NULL CONSTRAINT PK_feed_discovery_cache PRIMARY KEY CLUSTERED,
        results_json NVARCHAR(MAX) NOT NULL,
        total_sources_found INT NOT NULL DEFAULT 0,
        total_articles_found INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_discovery_cache_expires ON dbo.feed_discovery_cache(expires_at);
END
GO

-- DISCOVERED SOURCES
IF OBJECT_ID('dbo.discovered_sources', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.discovered_sources (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_discovered_sources PRIMARY KEY CLUSTERED,
        query_key NVARCHAR(255) NOT NULL,
        title NVARCHAR(255) NOT NULL,
        description NVARCHAR(1000) NULL,
        site_url NVARCHAR(1000) NOT NULL,
        feed_url NVARCHAR(1000) NOT NULL CONSTRAINT UQ_ds_feed_url UNIQUE,
        feed_type NVARCHAR(30) NOT NULL CONSTRAINT CK_ds_type CHECK (feed_type IN ('rss', 'atom', 'substack', 'youtube', 'podcast', 'research')),
        category NVARCHAR(100) NULL,
        publisher_name NVARCHAR(255) NULL,
        authority_score INT NOT NULL DEFAULT 50,
        publishing_frequency FLOAT NOT NULL DEFAULT 1.0,
        feed_health_pct FLOAT NOT NULL DEFAULT 100.0,
        subscriber_count INT NOT NULL DEFAULT 0,
        discovery_score FLOAT NOT NULL DEFAULT 0.5,
        discovery_layer INT NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL
    );

    CREATE NONCLUSTERED INDEX idx_discovered_sources_query ON dbo.discovered_sources(query_key, discovery_score DESC);
    CREATE NONCLUSTERED INDEX idx_discovered_sources_type ON dbo.discovered_sources(feed_type);
END
GO

-- SOURCE RECOMMENDATIONS
IF OBJECT_ID('dbo.source_recommendations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.source_recommendations (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_source_recommendations PRIMARY KEY CLUSTERED,
        source_id NVARCHAR(64) NOT NULL CONSTRAINT FK_sr_source FOREIGN KEY REFERENCES dbo.sources(id) ON DELETE CASCADE,
        recommended_source_id NVARCHAR(64) NOT NULL CONSTRAINT FK_sr_rec_source FOREIGN KEY REFERENCES dbo.sources(id),
        relationship_type NVARCHAR(50) NOT NULL CONSTRAINT CK_sr_type CHECK (relationship_type IN ('co_subscription', 'citation', 'same_topic', 'semantic_neighbor')),
        weight FLOAT NOT NULL DEFAULT 1.0,
        created_at BIGINT NOT NULL,
        CONSTRAINT UQ_source_recommendations UNIQUE (source_id, recommended_source_id, relationship_type)
    );

    CREATE NONCLUSTERED INDEX idx_source_rec_source ON dbo.source_recommendations(source_id, weight DESC);
END
GO

-- ==============================================================================
-- 12. SEED SEED DATA (INTEGRATIONS CATALOG)
-- ==============================================================================

IF NOT EXISTS (SELECT 1 FROM dbo.integrations WHERE id = 'int_slack')
BEGIN
    INSERT INTO dbo.integrations (id, code, name, category, icon, description, badge, setup_type, display_order, created_at) VALUES
    ('int_slack', 'slack', 'Slack', 'communication', '💬', 'Deliver real-time breaking alerts and scheduled daily briefings natively into your Slack channels using Block Kit cards.', 'Popular', 'webhook', 1, 1790000000000),
    ('int_teams', 'teams', 'Microsoft Teams', 'communication', '🟣', 'Send interactive Adaptive Cards to your Microsoft Teams channels via Power Automate Workflow webhooks.', 'Popular', 'webhook', 2, 1790000000000),
    ('int_discord', 'discord', 'Discord', 'communication', '🎮', 'Post rich news embeds directly into community servers and announcement channels.', 'Coming Soon', 'webhook', 3, 1790000000000),
    ('int_telegram', 'telegram', 'Telegram', 'communication', '✈️', 'Broadcast filtered feed matches and executive summaries to Telegram channels and bots.', 'Coming Soon', 'bot', 4, 1790000000000),
    ('int_zapier', 'zapier', 'Zapier', 'automation', '⚡', 'Connect FeedOmeter triggers to 5,000+ apps and trigger multi-step Zaps on new stories.', 'Popular', 'api_key', 5, 1790000000000),
    ('int_make', 'make', 'Make (Integromat)', 'automation', '🟣', 'Build visual automation scenarios connecting FeedOmeter syndicated articles to your CRM or data lake.', '', 'api_key', 6, 1790000000000),
    ('int_n8n', 'n8n', 'n8n', 'automation', '🔄', 'Fair-code workflow automation tool. Ingest FeedOmeter payloads into self-hosted nodes.', '', 'webhook', 7, 1790000000000),
    ('int_notion', 'notion', 'Notion', 'productivity', '📝', 'Automatically append matched intelligence articles and summaries into your team Notion databases.', 'Coming Soon', 'oauth', 8, 1790000000000),
    ('int_airtable', 'airtable', 'Airtable', 'productivity', '📊', 'Sync structured feed records, sentiment tags, and metadata into Airtable bases.', 'Coming Soon', 'api_key', 9, 1790000000000),
    ('int_webhook', 'webhook', 'Custom Webhook', 'developer', '⚡', 'Deliver signed HMAC-SHA256 JSON payloads directly to your custom HTTP POST backend endpoints.', 'Developer', 'webhook', 10, 1790000000000),
    ('int_api', 'api', 'FeedOmeter REST API', 'developer', '🔑', 'Full REST API access to search catalog, poll sources, and fetch structured articles programmatically.', 'Developer', 'api_key', 11, 1790000000000);
END
GO

PRINT '=============================================================================';
PRINT ' FeedOmeter 2.1 Complete SQL Server Schema & Indexes Created Successfully! ';
PRINT '=============================================================================';
GO
