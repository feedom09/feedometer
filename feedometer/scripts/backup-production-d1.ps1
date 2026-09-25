$tables = @('schema_migrations','search_clicks','search_queries','search_suggestions','sessions','source_health','source_lifecycle','sources','starred_articles','user_alerts','user_audit_log','user_audit_logs','user_auth_providers','user_digests','user_feed_assignments','user_feeds','user_integrations','user_passwords','user_preferences','user_push_subscriptions','user_sessions','user_webhooks','users','webhook_deliveries')
$backup = 'backups\feedometer-db-pre-phase6-release-20260924'
foreach ($table in $tables) {
  $output = Join-Path $backup ($table + '.sql')
  if (-not (Test-Path $output)) { npx wrangler d1 export feedometer-db --remote --table $table --output $output }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
