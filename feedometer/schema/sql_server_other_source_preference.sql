-- Phase 5: per-user switch for the detachable other-than-RSS discovery plugin.
-- Existing users retain access by default; setting the value to 0 hides the
-- plugin entry point for that user without affecting RSS discovery.
IF COL_LENGTH('dbo.user_preferences', 'other_source_discovery_enabled') IS NULL
BEGIN
    ALTER TABLE dbo.user_preferences
        ADD other_source_discovery_enabled TINYINT NOT NULL
            CONSTRAINT DF_upref_other_source_discovery_enabled DEFAULT 1
            CONSTRAINT CK_upref_other_source_discovery_enabled
                CHECK (other_source_discovery_enabled IN (0, 1));
END
GO
