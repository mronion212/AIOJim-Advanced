const database = require('./database');
const redisIdCache = require('./redis-id-cache');

/**
 * Automatically migrate ID mappings from SQLite to Redis on startup
 */
async function autoMigrateIdCache() {
  console.log('🔄 [Auto-Migration] Checking if Redis migration is needed...');
  
  try {
    // Check if Redis has any ID mappings
    const redisStats = await redisIdCache.getCacheStats();
    const redisKeyCount = redisStats ? redisStats.total_keys : 0;
    
    if (redisKeyCount > 0) {
      console.log(`✅ [Auto-Migration] Redis already has ${redisKeyCount} mappings. Skipping migration.`);
      return;
    }
    
    const dbType = database.type || 'database';
    console.log(`📦 [Auto-Migration] Redis is empty. Starting migration from ${dbType.toUpperCase()}...`);
    
    // Get total count from database
    const totalCount = await database.getTotalIdMappingCount();
    if (totalCount === 0) {
      console.log(`✅ [Auto-Migration] No mappings in ${dbType.toUpperCase()}. Nothing to migrate.`);
      return;
    }
    
    console.log(`📊 [Auto-Migration] Found ${totalCount} mappings in ${dbType.toUpperCase()}. Starting migration...`);
    
    const batchSize = 100;
    const totalBatches = Math.ceil(totalCount / batchSize);
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    const startTime = Date.now();
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const offset = batch * batchSize;
      const mappings = await database.getIdMappingsBatch(offset, batchSize);
      
      for (const mapping of mappings) {
        try {
          // Only save if we have at least 2 IDs
          const ids = [mapping.tmdb_id, mapping.tvdb_id, mapping.imdb_id, mapping.tvmaze_id].filter(Boolean);
          if (ids.length >= 2) {
            await redisIdCache.saveIdMapping(
              mapping.content_type,
              mapping.tmdb_id,
              mapping.tvdb_id,
              mapping.imdb_id,
              mapping.tvmaze_id
            );
            migratedCount++;
          } else {
            skippedCount++;
          }
        } catch (error) {
          console.error(`[Auto-Migration] Error migrating mapping:`, error.message);
          errorCount++;
        }
      }
      
      // Log progress every 10 batches
      if ((batch + 1) % 10 === 0 || batch === totalBatches - 1) {
        const progress = Math.round(((batch + 1) / totalBatches) * 100);
        console.log(`📦 [Auto-Migration] Progress: ${progress}% (${batch + 1}/${totalBatches} batches)`);
      }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`🎉 [Auto-Migration] Migration completed in ${duration}ms:`);
    console.log(`   ✅ Migrated: ${migratedCount} mappings`);
    console.log(`   ⏭️  Skipped: ${skippedCount} mappings (insufficient data)`);
    console.log(`   ❌ Errors: ${errorCount} mappings`);
    console.log(`   📈 Average: ${Math.round(duration / migratedCount)}ms per mapping`);
    
    // Test the migration
    console.log('🔍 [Auto-Migration] Testing migration...');
    const testResult = await redisIdCache.getCacheStats();
    if (testResult && testResult.total_keys > 0) {
      console.log(`✅ [Auto-Migration] Verification successful: ${testResult.total_keys} keys in Redis`);
    } else {
      console.log('⚠️  [Auto-Migration] Warning: No keys found in Redis after migration');
    }
    
  } catch (error) {
    console.error('❌ [Auto-Migration] Migration failed:', error.message);
    console.log('💡 [Auto-Migration] Application will continue with empty Redis cache');
  }
}

module.exports = { autoMigrateIdCache };
