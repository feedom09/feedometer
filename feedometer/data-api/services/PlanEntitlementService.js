/**
 * FeedOmeter 2.1 — PlanEntitlementService
 * Domain Service for Tiered Quotas, Feature Entitlements & Rate Limit Policies
 */

const { query, sql } = require('../config/db');

const PLAN_LIMITS = {
  free: {
    maxFeeds: 50,
    maxFolders: 10,
    maxAlerts: 3,
    maxCustomBuilders: 2,
    maxCollections: 5,
    hasAiSummaries: false,
    hasWebhookIntegrations: false,
    pollIntervalMins: 60,
    apiRequestsPerHour: 100
  },
  pro: {
    maxFeeds: 500,
    maxFolders: 50,
    maxAlerts: 25,
    maxCustomBuilders: 20,
    maxCollections: 50,
    hasAiSummaries: true,
    hasWebhookIntegrations: true,
    pollIntervalMins: 15,
    apiRequestsPerHour: 2000
  },
  enterprise: {
    maxFeeds: 5000,
    maxFolders: 500,
    maxAlerts: 200,
    maxCustomBuilders: 200,
    maxCollections: 500,
    hasAiSummaries: true,
    hasWebhookIntegrations: true,
    pollIntervalMins: 5,
    apiRequestsPerHour: 20000
  }
};

class PlanEntitlementService {
  /**
   * Get limits for a given plan name
   */
  getPlanLimits(plan = 'free') {
    return PLAN_LIMITS[plan.toLowerCase()] || PLAN_LIMITS.free;
  }

  /**
   * Check if a user can perform an action based on their quota
   */
  async checkEntitlement(userId, resourceType) {
    const userRes = await query(`
      SELECT [plan], status FROM dbo.users WHERE id = @userId
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    if (!userRes.recordset || userRes.recordset.length === 0) {
      throw new Error('User not found.');
    }

    const plan = userRes.recordset[0].plan || 'free';
    const limits = this.getPlanLimits(plan);

    switch (resourceType) {
      case 'feed': {
        const count = await query(`SELECT COUNT(*) AS total FROM dbo.user_feeds WHERE user_id = @userId`, {
          userId: { type: sql.NVarChar(64), value: userId }
        });
        const total = count.recordset[0].total;
        return {
          allowed: total < limits.maxFeeds,
          current: total,
          max: limits.maxFeeds,
          plan
        };
      }

      case 'folder': {
        const count = await query(`SELECT COUNT(*) AS total FROM dbo.folders WHERE user_id = @userId`, {
          userId: { type: sql.NVarChar(64), value: userId }
        });
        const total = count.recordset[0].total;
        return {
          allowed: total < limits.maxFolders,
          current: total,
          max: limits.maxFolders,
          plan
        };
      }

      case 'alert': {
        const count = await query(`SELECT COUNT(*) AS total FROM dbo.user_alerts WHERE user_id = @userId`, {
          userId: { type: sql.NVarChar(64), value: userId }
        });
        const total = count.recordset[0].total;
        return {
          allowed: total < limits.maxAlerts,
          current: total,
          max: limits.maxAlerts,
          plan
        };
      }

      case 'builder': {
        const count = await query(`SELECT COUNT(*) AS total FROM dbo.feed_builder_configs WHERE user_id = @userId`, {
          userId: { type: sql.NVarChar(64), value: userId }
        });
        const total = count.recordset[0].total;
        return {
          allowed: total < limits.maxCustomBuilders,
          current: total,
          max: limits.maxCustomBuilders,
          plan
        };
      }

      default:
        return { allowed: true, plan };
    }
  }
}

module.exports = new PlanEntitlementService();
