const redis = require('./redisClient');

class RedisIdCache {
  constructor() {
    this.redis = redis;
    this.keyPrefix = 'id_mapping:';
    this.ttl = 90 * 24 * 60 * 60; // 90 days in seconds
  }

  /**
   * Generate Redis key for ID mapping
   */
  getKey(contentType, tmdbId = null, tvdbId = null, imdbId = null, tvmazeId = null) {
    // Create a deterministic key based on available IDs
    const ids = [];
    if (tmdbId) ids.push(`tmdb:${tmdbId}`);
    if (tvdbId) ids.push(`tvdb:${tvdbId}`);
    if (imdbId) ids.push(`imdb:${imdbId}`);
    if (tvmazeId) ids.push(`tvmaze:${tvmazeId}`);
    
    if (ids.length === 0) return null;
    
    // Sort IDs for consistent key generation
    ids.sort();
    return `${this.keyPrefix}${contentType}:${ids.join(':')}`;
  }

  /**
   * Get cached ID mapping
   */
  async getCachedIdMapping(contentType, tmdbId = null, tvdbId = null, imdbId = null, tvmazeId = null) {
    if (!this.redis) return null;

    const key = this.getKey(contentType, tmdbId, tvdbId, imdbId, tvmazeId);
    if (!key) return null;

    try {
      const startTime = Date.now();
      const cached = await this.redis.get(key);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`[Redis ID Cache] GET ${key} (${duration}ms):`, cached ? 'HIT' : 'MISS');
      
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error(`[Redis ID Cache] Error getting ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Save ID mapping to cache
   */
  async saveIdMapping(contentType, tmdbId = null, tvdbId = null, imdbId = null, tvmazeId = null) {
    if (!this.redis) return;

    // Skip if no IDs provided or only one ID
    const ids = [tmdbId, tvdbId, imdbId, tvmazeId].filter(Boolean);
    if (ids.length <= 1) return;

    const mapping = {
      content_type: contentType,
      tmdb_id: tmdbId,
      tvdb_id: tvdbId,
      imdb_id: imdbId,
      tvmaze_id: tvmazeId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    try {
      const startTime = Date.now();
      const key = this.getKey(contentType, tmdbId, tvdbId, imdbId, tvmazeId);
      
      if (key) {
        await this.redis.setex(key, this.ttl, JSON.stringify(mapping));
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`[Redis ID Cache] SET ${key} (${duration}ms)`);
      }
    } catch (error) {
      console.error(`[Redis ID Cache] Error saving mapping:`, error.message);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    if (!this.redis) return null;

    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      const stats = {
        total_keys: keys.length,
        memory_usage: 0, // Skip memory usage for now
        ttl: this.ttl
      };
      return stats;
    } catch (error) {
      console.error(`[Redis ID Cache] Error getting stats:`, error.message);
      return null;
    }
  }

  /**
   * Clear all ID mappings
   */
  async clearAllCache() {
    if (!this.redis) return 0;

    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      console.log(`[Redis ID Cache] Cleared ${keys.length} mappings`);
      return keys.length;
    } catch (error) {
      console.error(`[Redis ID Cache] Error clearing cache:`, error.message);
      return 0;
    }
  }

  /**
   * Search for mappings by any ID
   */
  async searchByAnyId(contentType, tmdbId = null, tvdbId = null, imdbId = null, tvmazeId = null) {
    if (!this.redis) return null;

    const startTime = Date.now();
    
    // Try specific key patterns first (much faster than scanning all keys)
    const keyPatterns = [];
    
    if (tmdbId) keyPatterns.push(`${this.keyPrefix}${contentType}:*tmdb:${tmdbId}*`);
    if (tvdbId) keyPatterns.push(`${this.keyPrefix}${contentType}:*tvdb:${tvdbId}*`);
    if (imdbId) keyPatterns.push(`${this.keyPrefix}${contentType}:*imdb:${imdbId}*`);
    if (tvmazeId) keyPatterns.push(`${this.keyPrefix}${contentType}:*tvmaze:${tvmazeId}*`);

    if (keyPatterns.length === 0) return null;

    try {
      // Try each pattern until we find a match
      for (const pattern of keyPatterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          // Get the first matching key
          const cached = await this.redis.get(keys[0]);
          if (cached) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.log(`[Redis ID Cache] Found mapping by pattern ${pattern} (${duration}ms): ${keys[0]}`);
            return JSON.parse(cached);
          }
        }
      }
    } catch (error) {
      console.error(`[Redis ID Cache] Error searching for mappings:`, error.message);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`[Redis ID Cache] No mapping found (${duration}ms)`);
    return null;
  }
}

module.exports = new RedisIdCache();
