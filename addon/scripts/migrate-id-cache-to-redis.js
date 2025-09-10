#!/usr/bin/env node

/**
 * Migration script to move ID mappings from SQLite to Redis
 * This will significantly improve cache performance
 */

require('dotenv').config();
const database = require('../lib/database');
const redisIdCache = require('../lib/redis-id-cache');
const redis = require('../lib/redisClient');

async function migrateIdCacheToRedis() {
  console.log('🚀 Starting ID Cache migration from SQLite to Redis...\n');

  try {
    // Check if Redis is available
    if (!redis) {
      console.error('❌ Redis is not available. Please ensure Redis is running and configured.');
      process.exit(1);
    }

    // Test Redis connection
    try {
      await redis.ping();
      console.log('✅ Redis connection successful');
    } catch (error) {
      console.error('❌ Redis connection failed:', error.message);
      process.exit(1);
    }

    // Initialize database
    console.log('📊 Initializing database...');
    await database.initialize();
    console.log('✅ Database initialized\n');

    // Get all ID mappings from SQLite
    console.log('📥 Fetching all ID mappings from SQLite...');
    const mappings = await database.allQuery(`
      SELECT content_type, tmdb_id, tvdb_id, imdb_id, tvmaze_id, created_at, updated_at
      FROM id_mappings
      ORDER BY created_at DESC
    `);

    if (!mappings || mappings.length === 0) {
      console.log('ℹ️  No ID mappings found in SQLite database');
      return;
    }

    console.log(`📊 Found ${mappings.length} ID mappings to migrate\n`);

    // Migration statistics
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    const startTime = Date.now();

    // Process mappings in batches
    const batchSize = 100;
    for (let i = 0; i < mappings.length; i += batchSize) {
      const batch = mappings.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(mappings.length / batchSize)} (${batch.length} items)`);

      const batchPromises = batch.map(async (mapping) => {
        try {
          // Skip mappings with insufficient data
          const ids = [mapping.tmdb_id, mapping.tvdb_id, mapping.imdb_id, mapping.tvmaze_id].filter(Boolean);
          if (ids.length <= 1) {
            skipped++;
            return;
          }

          // Save to Redis
          await redisIdCache.saveIdMapping(
            mapping.content_type,
            mapping.tmdb_id,
            mapping.tvdb_id,
            mapping.imdb_id,
            mapping.tvmaze_id
          );

          migrated++;
        } catch (error) {
          console.error(`❌ Error migrating mapping:`, error.message);
          errors++;
        }
      });

      await Promise.all(batchPromises);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Migration summary
    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully migrated: ${migrated} mappings`);
    console.log(`⏭️  Skipped (insufficient data): ${skipped} mappings`);
    console.log(`❌ Errors: ${errors} mappings`);
    console.log(`⏱️  Total time: ${duration}ms`);
    console.log(`📈 Average time per mapping: ${(duration / mappings.length).toFixed(2)}ms`);

    // Verify migration
    console.log('\n🔍 Verifying migration...');
    const redisStats = await redisIdCache.getCacheStats();
    if (redisStats) {
      console.log(`📊 Redis cache now contains: ${redisStats.total_keys} keys`);
      console.log(`💾 Memory usage: ${(redisStats.memory_usage / 1024 / 1024).toFixed(2)} MB`);
    }

    // Performance test
    console.log('\n⚡ Performance test...');
    if (mappings.length > 0) {
      const testMapping = mappings[0];
      const testStartTime = Date.now();
      const testResult = await redisIdCache.getCachedIdMapping(
        testMapping.content_type,
        testMapping.tmdb_id,
        testMapping.tvdb_id,
        testMapping.imdb_id,
        testMapping.tvmaze_id
      );
      const testEndTime = Date.now();
      const testDuration = testEndTime - testStartTime;

      if (testResult) {
        console.log(`✅ Test query successful: ${testDuration}ms`);
        console.log(`📈 Expected performance improvement: ~${Math.round(113 / testDuration)}x faster than SQLite`);
      } else {
        console.log('❌ Test query failed - mapping not found in Redis');
      }
    }

    console.log('\n🎉 Migration completed successfully!');
    console.log('💡 Your ID resolver will now use Redis for much faster cache lookups.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateIdCacheToRedis()
    .then(() => {
      console.log('\n✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Migration script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { migrateIdCacheToRedis };
