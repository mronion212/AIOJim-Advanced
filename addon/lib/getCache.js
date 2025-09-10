// FILE: lib/getCache.js

const packageJson = require('../../package.json');
const redis = require('./redisClient');
const { loadConfigFromDatabase } = require('./configApi');


const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const GLOBAL_NO_CACHE = process.env.NO_CACHE === 'true';
const ADDON_VERSION = packageJson.version;

// --- Time To Live (TTL) constants in seconds ---
const META_TTL = parseInt(process.env.META_TTL || 7 * 24 * 60 * 60, 10);
const CATALOG_TTL = parseInt(process.env.CATALOG_TTL || 1 * 24 * 60 * 60, 10);
const JIKAN_API_TTL = 7 * 24 * 60 * 60;
const STATIC_CATALOG_TTL = 30 * 24 * 60 * 60;
const TVDB_API_TTL = 12 * 60 * 60;
const TVMAZE_API_TTL = 12 * 60 * 60;

// Enhanced error caching strategy with self-healing
const ERROR_TTL_STRATEGIES = {
  EMPTY_RESULT: 0,             // Don't cache empty results at all
  RATE_LIMITED: 15 * 60,       // 15 minutes for rate limit errors
  TEMPORARY_ERROR: 2 * 60,     // 2 minutes for temporary errors
  PERMANENT_ERROR: 30 * 60,    // 30 minutes for permanent errors
  NOT_FOUND: 60 * 60,          // 1 hour for not found errors
  CACHE_CORRUPTED: 1 * 60,     // 1 minute for corrupted cache entries
};

// Cache health monitoring
const cacheHealth = {
  hits: 0,
  misses: 0,
  errors: 0,
  corruptedEntries: 0,
  lastHealthCheck: Date.now(),
  errorCounts: {},
  keyAccessCounts: new Map()
};

// Self-healing configuration
const SELF_HEALING_CONFIG = {
  enabled: process.env.ENABLE_SELF_HEALING !== 'false',
  maxRetries: parseInt(process.env.CACHE_MAX_RETRIES || '2', 10),
  retryDelay: parseInt(process.env.CACHE_RETRY_DELAY || '1000', 10),
  healthCheckInterval: parseInt(process.env.CACHE_HEALTH_CHECK_INTERVAL || '300000', 10), // 5 minutes
  corruptedEntryThreshold: parseInt(process.env.CACHE_CORRUPTED_THRESHOLD || '10', 10)
};

const inFlightRequests = new Map();
const cacheValidator = require('./cacheValidator');

// Helper to resolve art provider for specific art type
function resolveArtProvider(contentType, artType, config) {
  const artProviderConfig = config.artProviders?.[contentType];
  
  // Handle legacy string format
  if (typeof artProviderConfig === 'string') {
    return artProviderConfig === 'meta' 
      ? config.providers?.[contentType] || getDefaultProvider(contentType)
      : artProviderConfig;
  }
  
  // Handle new nested object format
  if (artProviderConfig && typeof artProviderConfig === 'object') {
    const provider = artProviderConfig[artType];
    return provider === 'meta' 
      ? config.providers?.[contentType] || getDefaultProvider(contentType)
      : provider || getDefaultProvider(contentType);
  }
  
  // Fallback to meta provider
  return config.providers?.[contentType] || getDefaultProvider(contentType);
}

function getDefaultProvider(contentType) {
  switch (contentType) {
    case 'anime': return 'mal';
    case 'movie': return 'tmdb';
    case 'series': return 'tvdb';
    default: return 'tmdb';
  }
}

/**
 * Truncate long cache keys for better log readability
 */
function truncateCacheKey(key, maxLength = 80) {
  if (key.length <= maxLength) return key;
  
  // Try to preserve the most important parts: version, cache type, and catalog info
  const parts = key.split(':');
  if (parts.length >= 4) {
    const version = parts[0];
    const cacheType = parts[1];
    const catalogInfo = parts.slice(2).join(':');
    
    // If we have catalog info (like tmdb.top:series:{}), try to preserve it
    if (catalogInfo.includes('.') && catalogInfo.includes(':')) {
      const catalogParts = catalogInfo.split(':');
      const catalogProvider = catalogParts[0]; // e.g., "tmdb.top"
      const catalogType = catalogParts[1]; // e.g., "series"
      const catalogParams = catalogParts.slice(2).join(':'); // e.g., "{}"
      
      const availableLength = maxLength - version.length - cacheType.length - catalogProvider.length - catalogType.length - catalogParams.length - 6; // 6 for colons and "..."
      
      if (availableLength > 10) {
        // We have enough space to show some of the config string
        return `${version}:${cacheType}:${catalogProvider}:${catalogType}:${catalogParams.substring(0, availableLength)}...`;
      } else {
        // Not enough space, just show the essential parts
        return `${version}:${cacheType}:${catalogProvider}:${catalogType}:...`;
      }
    }
  }
  
  // Fallback: preserve version and cache type, truncate the rest
  if (parts.length >= 3) {
    const version = parts[0];
    const cacheType = parts[1];
    const remaining = parts.slice(2).join(':');
    
    if (remaining.length > maxLength - version.length - cacheType.length - 10) {
      const truncated = remaining.substring(0, maxLength - version.length - cacheType.length - 10);
      return `${version}:${cacheType}:${truncated}...`;
    }
  }
  
  return key.substring(0, maxLength - 3) + '...';
}

function safeParseConfigString(configString) {
  try {
    if (!configString) return null;
    const lz = require('lz-string');
    const decompressed = lz.decompressFromEncodedURIComponent(configString);
    if (!decompressed) return null;
    return JSON.parse(decompressed);
  } catch {
    return null;
  }
}

/**
 * Self-healing cache health monitoring
 */
function updateCacheHealth(key, type, success = true) {
  cacheHealth.keyAccessCounts.set(key, (cacheHealth.keyAccessCounts.get(key) || 0) + 1);
  
  if (success) {
    if (type === 'hit') {
      cacheHealth.hits++;
      // Also track in requestTracker for dashboard metrics
      try {
        const requestTracker = require('./requestTracker');
        requestTracker.trackCacheHit().catch(() => {}); // Don't let this fail silently
      } catch (error) {
        // Ignore if requestTracker is not available
      }
    } else if (type === 'miss') {
      cacheHealth.misses++;
      // Also track in requestTracker for dashboard metrics
      try {
        const requestTracker = require('./requestTracker');
        requestTracker.trackCacheMiss().catch(() => {}); // Don't let this fail silently
      } catch (error) {
        // Ignore if requestTracker is not available
      }
    }
  } else {
    cacheHealth.errors++;
  }
  
  // Periodic health check
  const now = Date.now();
  if (now - cacheHealth.lastHealthCheck > SELF_HEALING_CONFIG.healthCheckInterval) {
    logCacheHealth();
    cacheHealth.lastHealthCheck = now;
  }
}

/**
 * Log cache health statistics
 */
function logCacheHealth() {
  const total = cacheHealth.hits + cacheHealth.misses;
  const hitRate = total > 0 ? ((cacheHealth.hits / total) * 100).toFixed(2) : '0.00';
  const errorRate = total > 0 ? ((cacheHealth.errors / total) * 100).toFixed(2) : '0.00';
  
  console.log(`[Cache Health] Hit Rate: ${hitRate}%, Error Rate: ${errorRate}%, Total: ${total}`);
  console.log(`[Cache Health] Hits: ${cacheHealth.hits}, Misses: ${cacheHealth.misses}, Errors: ${cacheHealth.errors}`);
  
  // Log most accessed keys
  const topKeys = Array.from(cacheHealth.keyAccessCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  if (topKeys.length > 0) {
    console.log('[Cache Health] Most accessed keys:', topKeys.map(([key, count]) => `${key}:${count}`).join(', '));
  }
}

/**
 * Self-healing: Attempt to repair corrupted cache entries
 */
async function attemptSelfHealing(key, originalError) {
  if (!SELF_HEALING_CONFIG.enabled) return false;
  
  try {
    console.log(`[Self-Healing] Attempting to repair corrupted cache entry: ${key}`);
    
    // Remove corrupted entry
    await redis.del(key);
    cacheHealth.corruptedEntries++;
    
    // Cache the error with a short TTL to prevent repeated failures
    const errorResult = {
      error: true,
      type: 'CACHE_CORRUPTED',
      message: 'Cache entry was corrupted and removed',
      originalError: originalError.message,
      timestamp: new Date().toISOString()
    };
    
    await redis.set(key, JSON.stringify(errorResult), 'EX', ERROR_TTL_STRATEGIES.CACHE_CORRUPTED);
    
    console.log(`[Self-Healing] Successfully repaired corrupted cache entry: ${key}`);
    return true;
  } catch (error) {
    console.error(`[Self-Healing] Failed to repair cache entry ${key}:`, error);
    return false;
  }
}

/**
 * Enhanced result classification with self-healing awareness
 */
function classifyResult(result, error = null, cacheKey = null) {
  if (error) {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.status || error.code;
    
    if (errorCode === 404 || errorMessage.includes('not found')) {
      return { type: 'NOT_FOUND', ttl: ERROR_TTL_STRATEGIES.NOT_FOUND };
    }
    if (errorCode === 429 || errorMessage.includes('rate limit')) {
      return { type: 'RATE_LIMITED', ttl: ERROR_TTL_STRATEGIES.RATE_LIMITED };
    }
    if (errorCode >= 500 || errorMessage.includes('timeout') || errorMessage.includes('connection')) {
      return { type: 'TEMPORARY_ERROR', ttl: ERROR_TTL_STRATEGIES.TEMPORARY_ERROR };
    }
    return { type: 'PERMANENT_ERROR', ttl: ERROR_TTL_STRATEGIES.PERMANENT_ERROR };
  }
  
  if (!result) {
    return { type: 'EMPTY_RESULT', ttl: ERROR_TTL_STRATEGIES.EMPTY_RESULT };
  }
  
  // Check if this is an external API response (TVDB, TMDB, etc.)
  const isExternalApi = cacheKey && (
    cacheKey.includes('tvdb-api:') || 
    cacheKey.includes('tmdb-api:') || 
    cacheKey.includes('tvmaze-api:') ||
    cacheKey.includes('jikan-api:')
  );
  
  if (isExternalApi) {
    // For external APIs, any non-null result is valid
    const hasValidData = (typeof result === 'object' && result !== null && Object.keys(result).length > 0) ||
                        (Array.isArray(result) && result.length > 0) ||
                        (typeof result === 'string' && result.length > 0) ||
                        (typeof result === 'number');
    
    if (hasValidData) {
      return { type: 'SUCCESS', ttl: null };
    } else {
    return { type: 'EMPTY_RESULT', ttl: ERROR_TTL_STRATEGIES.EMPTY_RESULT };
    }
  }
  
  // For internal responses (meta, catalog, etc.)
  const hasMetaData = (result.meta && typeof result.meta === 'object' && Object.keys(result.meta).length > 0);
  const hasMetasData = (Array.isArray(result.metas) && result.metas.length > 0);
  const hasArrayData = (Array.isArray(result) && result.length > 0);
  
  if (hasMetaData || hasMetasData || hasArrayData) {
  return { type: 'SUCCESS', ttl: null };
  }
  
  return { type: 'EMPTY_RESULT', ttl: ERROR_TTL_STRATEGIES.EMPTY_RESULT };
}

/**
 * Enhanced cache wrapper with self-healing capabilities
 */
async function cacheWrap(key, method, ttl, options = {}) {
  if (GLOBAL_NO_CACHE || !redis) {
    return method();
  }

  const versionedKey = `v${ADDON_VERSION}:${key}`;
  const { enableErrorCaching = true, resultClassifier = classifyResult, maxRetries = SELF_HEALING_CONFIG.maxRetries } = options;

  if (inFlightRequests.has(versionedKey)) {
    return inFlightRequests.get(versionedKey);
  }
  
  let retries = 0;
  
  while (retries <= maxRetries) {
  try {
    const cached = await redis.get(versionedKey);
    if (cached) {
        try {
          const parsed = JSON.parse(cached);
          
          // Check if it's a cached error that should be retried
          if (parsed.error && parsed.type === 'TEMPORARY_ERROR') {
            const errorAge = Date.now() - new Date(parsed.timestamp).getTime();
            if (errorAge > ERROR_TTL_STRATEGIES.TEMPORARY_ERROR * 1000) {
              console.log(`📦 [Cache] Retrying expired temporary error for ${versionedKey}`);
              await redis.del(versionedKey);
            } else {
              console.log(`📦 [Cache] HIT (cached error) for ${versionedKey}`);
              updateCacheHealth(versionedKey, 'hit', true);
              return parsed;
            }
          } else if (parsed.error) {
            console.log(`📦 [Cache] HIT (cached error) for ${versionedKey}`);
            updateCacheHealth(versionedKey, 'hit', true);
            return parsed;
          } else {
            console.log(`⚡ 📦 [Cache] HIT for ${versionedKey}`);
            updateCacheHealth(versionedKey, 'hit', true);
            return parsed;
          }
        } catch (parseError) {
          console.warn(`📦 [Cache] Corrupted cache entry for ${versionedKey}, attempting self-healing`);
          await attemptSelfHealing(versionedKey, parseError);
          // Continue to retry the method
        }
    }
  } catch (err) {
    console.warn(`📦 [Cache] Failed to read from Redis for key ${versionedKey}:`, err);
      updateCacheHealth(versionedKey, 'error', false);
  }

  const promise = method();
  inFlightRequests.set(versionedKey, promise);

  try {
    const result = await promise;
      //console.log(`⏳ 📦 [Cache] MISS for ${versionedKey}`);
      updateCacheHealth(versionedKey, 'miss', true);
      
    if (result !== null && result !== undefined) {
        // Validate data before caching to prevent bad data from being cached
        let contentType = 'unknown';
        if (key.startsWith('meta')) {
          contentType = 'meta';
        } else if (key.startsWith('catalog')) {
          contentType = 'catalog';
        } else if (key.startsWith('search')) {
          contentType = 'search';
        } else if (key.startsWith('genre')) {
          contentType = 'genre';
        }
        const validation = cacheValidator.validateBeforeCache(result, contentType);
        
        if (!validation.isValid) {
          console.warn(`📦 [Cache] Preventing bad data from being cached for ${versionedKey}:`, validation.issues);
          updateCacheHealth(versionedKey, 'error', false);
          throw new Error(`Bad data detected: ${validation.issues.join(', ')}`);
        }
        
        const classification = resultClassifier(result, null, key);
        const finalTtl = classification.ttl !== null ? classification.ttl : ttl;
        
        console.log(`📦 [Cache] Classification: ${classification.type}, TTL: ${finalTtl}s`);
        
        // Skip caching if TTL is 0 (e.g., empty results)
        if (finalTtl > 0) {
        if (classification.type !== 'SUCCESS') {
            console.warn(`📦 [Cache] Caching ${classification.type} result for ${versionedKey} for ${finalTtl}s`);
        }
        
        try {
          await redis.set(versionedKey, JSON.stringify(result), 'EX', finalTtl);
      } catch (err) {
            console.warn(`📦 [Cache] Failed to write to Redis for key ${versionedKey}:`, err);
          updateCacheHealth(versionedKey, 'error', false);
          }
        } else {
          console.log(`📦 [Cache] Skipping cache for ${versionedKey} (TTL: 0)`);
        }
    }
    return result;
  } catch (error) {
    console.error(`📦 [Cache] Method failed for cache key ${versionedKey}:`, error);
      updateCacheHealth(versionedKey, 'error', false);
      
      // Cache error results if enabled
      if (enableErrorCaching) {
        const classification = resultClassifier(null, error);
        const errorTtl = classification.ttl;
        
        try {
          const errorResult = { 
            error: true, 
            type: classification.type, 
            message: error.message,
            timestamp: new Date().toISOString()
          };
          await redis.set(versionedKey, JSON.stringify(errorResult), 'EX', errorTtl);
          console.warn(`📦 [Cache] Cached ${classification.type} error for ${versionedKey} for ${errorTtl}s`);
        } catch (err) {
            console.warn(`📦 [Cache] Failed to cache error for key ${versionedKey}:`, err);
        }
      }
      
      // Retry logic for temporary errors
      if (retries < maxRetries && (error.status >= 500 || error.message?.includes('timeout'))) {
        retries++;
        console.log(`📦 [Cache] Retrying ${versionedKey} (attempt ${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, SELF_HEALING_CONFIG.retryDelay));
        continue;
      }
      
    throw error; 
  } finally {
    inFlightRequests.delete(versionedKey);
    }
  }
}

/**
 * Enhanced global cache wrapper with self-healing capabilities
 */
async function cacheWrapGlobal(key, method, ttl, options = {}) {
  if (GLOBAL_NO_CACHE || !redis) {
    return method();
  }

  const versionedKey = `global:${ADDON_VERSION}:${key}`;
  const { enableErrorCaching = true, resultClassifier = classifyResult, maxRetries = SELF_HEALING_CONFIG.maxRetries } = options;
  
  if (inFlightRequests.has(versionedKey)) {
    return inFlightRequests.get(versionedKey);
  }

  let retries = 0;
  
  while (retries <= maxRetries) {
  try {
    const cached = await redis.get(versionedKey);
    if (cached) {
        try {
          const parsed = JSON.parse(cached);
          
          if (parsed.error && parsed.type === 'TEMPORARY_ERROR') {
            const errorAge = Date.now() - new Date(parsed.timestamp).getTime();
            if (errorAge > ERROR_TTL_STRATEGIES.TEMPORARY_ERROR * 1000) {
              console.log(`🔄 [Global Cache] Retrying expired temporary error for ${truncateCacheKey(versionedKey)}`);
              await redis.del(versionedKey);
            } else {
              console.log(`❌ [Global Cache] HIT (cached error) for ${truncateCacheKey(versionedKey)}`);
              updateCacheHealth(versionedKey, 'hit', true);
              return parsed;
            }
          } else if (parsed.error) {
            console.log(`❌ [Global Cache] HIT (cached error) for ${truncateCacheKey(versionedKey)}`);
            updateCacheHealth(versionedKey, 'hit', true);
            return parsed;
          } else {
            console.log(`⚡ [Global Cache] HIT for ${truncateCacheKey(versionedKey)}`);
            updateCacheHealth(versionedKey, 'hit', true);
            return parsed;
          }
        } catch (parseError) {
          console.warn(`[Global Cache] Corrupted cache entry for ${versionedKey}, attempting self-healing`);
          await attemptSelfHealing(versionedKey, parseError);
        }
    }
  } catch (err) {
    console.warn(`[Global Cache] Redis GET error for key ${versionedKey}:`, err.message);
      updateCacheHealth(versionedKey, 'error', false);
  }

  const promise = method();
  inFlightRequests.set(versionedKey, promise);

  try {
    const result = await promise;
      //console.log(`⏳ [Global Cache] MISS for ${truncateCacheKey(versionedKey)}`);
      updateCacheHealth(versionedKey, 'miss', true);

      const classification = resultClassifier(result, null, key);
      const finalTtl = classification.ttl !== null ? classification.ttl : ttl;
      
      //console.log(`[Global Cache] Classification: ${classification.type}, TTL: ${finalTtl}s`);

      // Skip caching if result classifier says so
      if (classification.type === 'SKIP_CACHE') {
        console.log(`⏭️ [Global Cache] Skipping cache for ${truncateCacheKey(versionedKey)} as requested by classifier`);
        return result;
      }

      // Skip caching if TTL is 0 (e.g., empty results)
      if (finalTtl > 0) {
      if (classification.type !== 'SUCCESS') {
        console.warn(`[Global Cache] Caching ${classification.type} result for ${versionedKey} for ${finalTtl}s`);
    }

    if (result !== null && result !== undefined) {
      await redis.set(versionedKey, JSON.stringify(result), 'EX', finalTtl);
        }
      } else {
        console.log(`[Global Cache] Skipping cache for ${versionedKey} (TTL: 0)`);
    }
    return result;
  } catch (error) {
    console.error(`[Global Cache] Method failed for cache key ${versionedKey}:`, error);
      updateCacheHealth(versionedKey, 'error', false);
      
      // Cache error results if enabled
      if (enableErrorCaching) {
        const classification = resultClassifier(null, error);
        const errorTtl = classification.ttl;
        
        try {
          const errorResult = { 
            error: true, 
            type: classification.type, 
            message: error.message,
            timestamp: new Date().toISOString()
          };
          await redis.set(versionedKey, JSON.stringify(errorResult), 'EX', errorTtl);
          console.warn(`[Global Cache] Cached ${classification.type} error for ${versionedKey} for ${errorTtl}s`);
        } catch (err) {
          console.warn(`[Global Cache] Failed to cache error for key ${versionedKey}:`, err);
        }
      }
      
      // Retry logic for temporary errors
      if (retries < maxRetries && (error.status >= 500 || error.message?.includes('timeout'))) {
        retries++;
        console.log(`🔄 [Global Cache] Retrying ${truncateCacheKey(versionedKey)} (attempt ${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, SELF_HEALING_CONFIG.retryDelay));
        continue;
      }
      
    throw error;
  } finally {
    inFlightRequests.delete(versionedKey);
    }
  }
}

// --- Helper Functions ---

async function cacheWrapCatalog(userUUID, catalogKey, method, options = {}) {
  // Load config from database
  let config;
  try {
    config = await loadConfigFromDatabase(userUUID);
  } catch (error) {
    console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
    // Return empty response for invalid UUIDs instead of crashing
    return { metas: [] };
  }
  
  if (!config) {
    console.warn(`[Cache] No config found for user ${userUUID}`);
    return { metas: [] };
  }

  const idOnly = catalogKey.split(':')[0];
  const trendingIds = new Set(['tmdb.trending']);

  // Disable caching for trending catalogs since they change frequently
  if (trendingIds.has(idOnly)) {
    console.log(`📦 [Cache] Skipping cache for trending catalog: ${idOnly}`);
    return method(); // Execute without caching
  }
  
  // Create context-aware catalog config (only relevant parameters for catalogs)
  const catalogConfig = {
    // Language (affects all catalogs)
    language: config.language || 'en-US',
    
    // Provider settings (affect catalog content)
    providers: config.providers || {},
    artProviders: config.artProviders || {},
    
    // Content filtering (affects catalog results)
    sfw: config.sfw || false,
    includeAdult: config.includeAdult || false,
    ageRating: config.ageRating || null,
    showPrefix: config.showPrefix || false,
    showMetaProviderAttribution: config.showMetaProviderAttribution || false,
    
    // Streaming configuration (affects streaming catalog results)
    streaming: config.streaming || [],
    
    // Anime-specific settings (for MAL catalogs)
    mal: config.mal || {}
  };
  
  const catalogConfigString = JSON.stringify(catalogConfig);
  const key = `catalog:${catalogConfigString}:${catalogKey}`;
  
      console.log(`📦 [Cache] Catalog cache key (${idOnly}): ${key.substring(0, 120)}...`);
    
    return cacheWrap(key, method, CATALOG_TTL, options);
  }

/**
 * Search-specific cache wrapper with context-aware cache keys
 * Search results depend on different config parameters than catalogs
 */
async function cacheWrapSearch(userUUID, searchKey, method, options = {}) {
  // Load config from database
  let config;
  try {
    config = await loadConfigFromDatabase(userUUID);
  } catch (error) {
    console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
    // Return empty response for invalid UUIDs instead of crashing
    return { metas: [] };
  }
  
  if (!config) {
    console.warn(`[Cache] No config found for user ${userUUID}`);
    return { metas: [] };
  }
  
  // Search-specific config (only relevant parameters for search results)
  const searchConfig = {
    language: config.language || 'en-US',
    searchProviders: config.search?.providers || {},
    engineEnabled: config.search?.engineEnabled || {},
    sfw: config.sfw || false,
    includeAdult: config.includeAdult || false,
    ageRating: config.ageRating || null,
    // Add meta and art providers since they affect search results
    metaProviders: config.providers || {},
    artProviders: config.artProviders || {},
    // Add display settings that affect search results
    blurThumbs: config.blurThumbs || false,
    showPrefix: config.showPrefix || false,
    showMetaProviderAttribution: config.showMetaProviderAttribution || false
  };
  
  const searchConfigString = JSON.stringify(searchConfig);
  const key = `search:${searchConfigString}:${searchKey}`;
  
      console.log(`📦 [Cache] Search cache key: ${key.substring(0, 120)}...`);
  
  // Shorter TTL for search results since they're more dynamic
  const SEARCH_TTL = 10 * 60; // 10 minutes (vs 1 hour for catalogs)
  
  return cacheWrap(key, method, SEARCH_TTL, options);
}

async function cacheWrapMeta(userUUID, metaId, method, ttl = META_TTL, options = {}, type = null) {
   // Load config from database
   let config;
   try {
     config = await loadConfigFromDatabase(userUUID);
   } catch (error) {
     console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
     // Return empty response for invalid UUIDs instead of crashing
     return { meta: null };
   }
   
   if (!config) {
     console.warn(`[Cache] No config found for user ${userUUID}`);
     return { meta: null };
   }
   
   // Parse metaId to determine context (fallback if type not provided)
   const [prefix, sourceId] = metaId.split(':');
   const metaType = type;
   
   // Create context-aware meta config object
   const metaConfig = {
     // Language (affects all meta)
     language: config.language || 'en-US',
     
     // Display settings (affect all meta)
     castCount: config.castCount || 0,
     blurThumbs: config.blurThumbs || false,
     showMetaProviderAttribution: config.showMetaProviderAttribution || false, 
     
   };
   
   // Add context-specific settings based on meta type
   if (prefix === 'mal' || prefix === 'kitsu' || prefix === 'anilist' || prefix === 'anidb' || metaType === 'anime') {
     metaConfig.metaProvider = config.providers?.anime || 'mal';
     metaConfig.artProvider = {
       poster: resolveArtProvider('anime', 'poster', config),
       background: resolveArtProvider('anime', 'background', config),
       logo: resolveArtProvider('anime', 'logo', config)
     };
     metaConfig.animeIdProvider = config.providers?.anime_id_provider || 'imdb';
     metaConfig.mal = {
      skipFiller: config.mal?.skipFiller || false,
      skipRecap: config.mal?.skipRecap || false
    };
   } else if (metaType === 'movie') {
     metaConfig.metaProvider = config.providers?.movie || 'tmdb';
     metaConfig.artProvider = {
       poster: resolveArtProvider('movie', 'poster', config),
       background: resolveArtProvider('movie', 'background', config),
       logo: resolveArtProvider('movie', 'logo', config)
     };
   } else if (metaType === 'series') {
     metaConfig.metaProvider = config.providers?.series || 'tvdb';
     metaConfig.artProvider = {
       poster: resolveArtProvider('series', 'poster', config),
       background: resolveArtProvider('series', 'background', config),
       logo: resolveArtProvider('series', 'logo', config)
     };
     // TVDB season type only matters for TVDB series
     if (prefix === 'tvdb') {
       metaConfig.tvdbSeasonType = config.tvdbSeasonType || 'default';
     }

   }
   
   // Create cache key from context-aware meta config (no UUID for shared caching)
   const metaConfigString = JSON.stringify(metaConfig);
   const key = `meta:${metaConfigString}:${metaId}`;
   
       console.log(`📦 [Cache] Meta cache key (${prefix}/${metaType}): ${key.substring(0, 120)}...`);
   
   return cacheWrap(key, method, ttl, options);
}

/**
 * Granular component caching for meta objects
 * Caches individual components separately to prevent one bad component from affecting everything
 */
async function cacheWrapMetaComponents(userUUID, metaId, method, ttl = META_TTL, options = {}, type = null) {
   // Load config from database
   let config;
   try {
     config = await loadConfigFromDatabase(userUUID);
   } catch (error) {
     console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
     // Return empty response for invalid UUIDs instead of crashing
     return { meta: null };
   }
   
   if (!config) {
     console.warn(`[Cache] No config found for user ${userUUID}`);
     return { meta: null };
   }
   
   // Parse metaId to determine context
   const [prefix, sourceId] = metaId.split(':');
   const metaType = type;
   
   // Create context-aware meta config object (same as cacheWrapMeta)
   const metaConfig = {
     language: config.language || 'en-US',
     castCount: config.castCount || 0,
     blurThumbs: config.blurThumbs || false,
     showPrefix: config.showPrefix || false,
     showMetaProviderAttribution: config.showMetaProviderAttribution || true,
   };
   
   const isAnime = metaType === 'anime' || prefix === 'mal' || prefix === 'kitsu' || prefix === 'anilist' || prefix === 'anidb';
   
   if (isAnime) {
     metaConfig.metaProvider = config.providers?.anime || 'mal';
     metaConfig.artProvider = {
       poster: resolveArtProvider('anime', 'poster', config),
       background: resolveArtProvider('anime', 'background', config),
       logo: resolveArtProvider('anime', 'logo', config)
     };
     metaConfig.animeIdProvider = config.providers?.anime_id_provider || 'imdb';
     metaConfig.mal = {
       skipFiller: config.mal?.skipFiller || false,
       skipRecap: config.mal?.skipRecap || false
     };
   } else if (metaType === 'movie') {
     metaConfig.metaProvider = config.providers?.movie || 'tmdb';
     metaConfig.artProvider = {
       poster: resolveArtProvider('movie', 'poster', config),
       background: resolveArtProvider('movie', 'background', config),
       logo: resolveArtProvider('movie', 'logo', config)
     };
   } else if (metaType === 'series') {
     metaConfig.metaProvider = config.providers?.series || 'tvdb';
     metaConfig.artProvider = {
       poster: resolveArtProvider('series', 'poster', config),
       background: resolveArtProvider('series', 'background', config),
       logo: resolveArtProvider('series', 'logo', config)
     };
     if (prefix === 'tvdb') {
       metaConfig.tvdbSeasonType = config.tvdbSeasonType || 'default';
     }
   }
   
   const metaConfigString = JSON.stringify(metaConfig);
   
   // Define component cache keys
   const componentCacheKeys = {
     basic: `meta-basic:${metaConfigString}:${metaId}`,
     poster: `meta-poster:${metaConfigString}:${metaId}`,
     background: `meta-background:${metaConfigString}:${metaId}`,
     logo: `meta-logo:${metaConfigString}:${metaId}`,
     videos: `meta-videos:${metaConfigString}:${metaId}`,
     cast: `meta-cast:${metaConfigString}:${metaId}`,
     director: `meta-director:${metaConfigString}:${metaId}`,
     writer: `meta-writer:${metaConfigString}:${metaId}`,
     links: `meta-links:${metaConfigString}:${metaId}`,
     trailers: `meta-trailers:${metaConfigString}:${metaId}`,
     extras: `meta-extras:${metaConfigString}:${metaId}`
   };
   
   // Debug: Log cache keys for different content types
   /*console.log(`📦 [Cache] DEBUG: Generated cache keys for ${metaId} (type: ${metaType}):`);
   console.log(`📦 [Cache] DEBUG:   metaConfig: ${metaConfigString}`);
   console.log(`📦 [Cache] DEBUG:   poster key: ${componentCacheKeys.poster}`);
   console.log(`📦 [Cache] DEBUG:   background key: ${componentCacheKeys.background}`);*/
   
   const result = await method();
   
   const meta = result?.meta || result;
   
  if (!meta || !meta.id || !meta.name || !meta.type) {
          console.warn(`📦 [Cache] No valid meta object returned for ${metaId}`);
    return { meta: null };
  }
  
  // Capture metadata for dashboard display
  try {
    const requestTracker = require('./requestTracker');
    await requestTracker.captureMetadataFromComponents(metaId, meta, meta.type);
  } catch (error) {
    console.warn(`[Cache] Failed to capture metadata for dashboard: ${error.message}`);
  }
   
   const componentPromises = [];
   
   const basicMeta = {
     id: meta.id,
     name: meta.name,
     type: meta.type,
     description: meta.description,
     imdb_id: meta.imdb_id,
     slug: meta.slug,
     genres: meta.genres,
     director: meta.director,
     writer: meta.writer,
     year: meta.year,
     releaseInfo: meta.releaseInfo,
     released: meta.released,
     runtime: meta.runtime,
     country: meta.country,
     imdbRating: meta.imdbRating,
     behaviorHints: meta.behaviorHints
   };
   
   componentPromises.push(
     cacheComponent(componentCacheKeys.basic, basicMeta, ttl)
   );
   
   // Poster
   if (meta.poster) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.poster, { poster: meta.poster }, ttl)
     );
   }
   
   // Background
   if (meta.background) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.background, { background: meta.background }, ttl)
     );
   }
   
   // Logo
   if (meta.logo) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.logo, { logo: meta.logo }, ttl)
     );
   }
   
   // Videos (episodes for series)
   if (meta.videos && Array.isArray(meta.videos)) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.videos, { videos: meta.videos }, ttl)
     );
   }
   
   // Cast - only cache if castCount is not configured (unlimited cast)
   // When castCount is configured, we don't cache cast to avoid serving wrong cast count
   if (meta.app_extras?.cast && (!config.castCount || config.castCount === 0)) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.cast, { cast: meta.app_extras.cast }, ttl)
     );
   }
   
   // Director details
   if (meta.app_extras?.directors) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.director, { directors: meta.app_extras.directors }, ttl)
     );
   }
   
   // Writer details
   if (meta.app_extras?.writers) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.writer, { writers: meta.app_extras.writers }, ttl)
     );
   }
   
   // Links
   if (meta.links && Array.isArray(meta.links)) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.links, { links: meta.links }, ttl)
     );
   }
   
   // Trailers
   if (meta.trailers) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.trailers, { trailers: meta.trailers }, ttl)
     );
   }
   
   // Trailer streams
   if (meta.trailerStreams) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.trailers, { trailerStreams: meta.trailerStreams }, ttl)
     );
   }
   
   // App extras (combined)
   if (meta.app_extras) {
     componentPromises.push(
       cacheComponent(componentCacheKeys.extras, { app_extras: meta.app_extras }, ttl)
     );
   }
   
     // Cache all components in parallel
  await Promise.all(componentPromises);
   
   // Return the meta object wrapped in the expected format
   return { meta };
}

/**
 * Reconstruct meta object from cached components
 * This allows for partial cache hits and graceful degradation
 */
async function reconstructMetaFromComponents(userUUID, metaId, ttl = META_TTL, options = {}, type = null) {
   // Load config from database
   let config;
   try {
     config = await loadConfigFromDatabase(userUUID);
   } catch (error) {
     console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
     // Return null for invalid UUIDs instead of crashing
     return null;
   }
   
   if (!config) {
     console.warn(`[Cache] No config found for user ${userUUID}`);
     return null;
   }
   
   // Parse metaId to determine context
   const [prefix, sourceId] = metaId.split(':');
   const metaType = type;
   
   // Create context-aware meta config object (same as cacheWrapMeta)
   const metaConfig = {
     language: config.language || 'en-US',
     castCount: config.castCount || 0,
     blurThumbs: config.blurThumbs || false,
     showPrefix: config.showPrefix || false,
     showMetaProviderAttribution: config.showMetaProviderAttribution || true,
   };
   
   const isAnime = prefix === 'mal' || prefix === 'kitsu' || prefix === 'anilist' || prefix === 'anidb' || metaType === 'anime';
   
   if (isAnime) {
     metaConfig.metaProvider = config.providers?.anime || 'mal';
     metaConfig.artProvider = {
       poster: resolveArtProvider('anime', 'poster', config),
       background: resolveArtProvider('anime', 'background', config),
       logo: resolveArtProvider('anime', 'logo', config)
     };
     metaConfig.animeIdProvider = config.providers?.anime_id_provider || 'imdb';
     metaConfig.mal = {
       skipFiller: config.mal?.skipFiller || false,
       skipRecap: config.mal?.skipRecap || false
     };
   } else if (metaType === 'movie') {
     metaConfig.metaProvider = config.providers?.movie || 'tmdb';
     metaConfig.artProvider = {
       poster: resolveArtProvider('movie', 'poster', config),
       background: resolveArtProvider('movie', 'background', config),
       logo: resolveArtProvider('movie', 'logo', config)
     };
   } else if (metaType === 'series') {
     metaConfig.metaProvider = config.providers?.series || 'tvdb';
     metaConfig.artProvider = {
       poster: resolveArtProvider('series', 'poster', config),
       background: resolveArtProvider('series', 'background', config),
       logo: resolveArtProvider('series', 'logo', config)
     };
     if (prefix === 'tvdb') {
       metaConfig.tvdbSeasonType = config.tvdbSeasonType || 'default';
     }
   }
   
   const metaConfigString = JSON.stringify(metaConfig);
   
   // Define component cache keys
   const componentCacheKeys = {
     basic: `meta-basic:${metaConfigString}:${metaId}`,
     poster: `meta-poster:${metaConfigString}:${metaId}`,
     background: `meta-background:${metaConfigString}:${metaId}`,
     logo: `meta-logo:${metaConfigString}:${metaId}`,
     videos: `meta-videos:${metaConfigString}:${metaId}`,
     cast: `meta-cast:${metaConfigString}:${metaId}`,
     director: `meta-director:${metaConfigString}:${metaId}`,
     writer: `meta-writer:${metaConfigString}:${metaId}`,
     links: `meta-links:${metaConfigString}:${metaId}`,
     trailers: `meta-trailers:${metaConfigString}:${metaId}`,
     extras: `meta-extras:${metaConfigString}:${metaId}`
   };
   
   // Try to fetch all components from cache
   const componentPromises = Object.entries(componentCacheKeys).map(async ([componentName, cacheKey]) => {
     try {
       const cached = await redis.get(cacheKey);
       if (cached) {
         const parsed = JSON.parse(cached);
         //console.log(`📦 [Cache] Component HIT: ${componentName} for ${metaId}`);
         return { componentName, data: parsed };
       } else {
         //console.log(`📦 [Cache] Component MISS: ${componentName} for ${metaId}`);
         return { componentName, data: null };
       }
     } catch (error) {
       console.warn(`📦 [Cache] Error fetching component ${componentName}:`, error);
       return { componentName, data: null };
     }
   });
   
   const componentResults = await Promise.all(componentPromises);
   const availableComponents = componentResults.filter(result => result.data !== null);
   
     if (availableComponents.length === 0) {
    return null;
  }
   
   // Reconstruct meta object from available components
   const reconstructedMeta = {};
   
   // Start with basic meta
   const basicComponent = availableComponents.find(c => c.componentName === 'basic');
   if (basicComponent) {
     Object.assign(reconstructedMeta, basicComponent.data);
   }
   
   // Add other components
   availableComponents.forEach(({ componentName, data }) => {
     if (componentName === 'basic') return; // Already handled
     
     if (componentName === 'poster') {
       reconstructedMeta.poster = data.poster;
     } else if (componentName === 'background') {
       reconstructedMeta.background = data.background;
     } else if (componentName === 'logo') {
       reconstructedMeta.logo = data.logo;
     } else if (componentName === 'videos') {
       reconstructedMeta.videos = data.videos;
     } else if (componentName === 'cast') {
       if (!reconstructedMeta.app_extras) reconstructedMeta.app_extras = {};
       // Cast is only cached when castCount is unlimited, so use it directly
       reconstructedMeta.app_extras.cast = data.cast;
     } else if (componentName === 'director') {
       if (!reconstructedMeta.app_extras) reconstructedMeta.app_extras = {};
       reconstructedMeta.app_extras.directors = data.directors;
     } else if (componentName === 'writer') {
       if (!reconstructedMeta.app_extras) reconstructedMeta.app_extras = {};
       reconstructedMeta.app_extras.writers = data.writers;
     } else if (componentName === 'links') {
       reconstructedMeta.links = data.links;
     } else if (componentName === 'trailers') {
       if (data.trailers) reconstructedMeta.trailers = data.trailers;
       if (data.trailerStreams) reconstructedMeta.trailerStreams = data.trailerStreams;
     } else if (componentName === 'extras') {
       reconstructedMeta.app_extras = data.app_extras;
     }
   });
   
  // Validate the reconstructed meta
  if (!reconstructedMeta.id || !reconstructedMeta.name || !reconstructedMeta.type) {
    console.warn(`📦 [Cache] Reconstructed meta missing required fields for ${metaId}`);
    return null;
  }
  
  // Capture metadata for dashboard display
  try {
    const requestTracker = require('./requestTracker');
    await requestTracker.captureMetadataFromComponents(metaId, reconstructedMeta, reconstructedMeta.type);
  } catch (error) {
    console.warn(`[Cache] Failed to capture metadata for dashboard: ${error.message}`);
  }
  
  console.log(`📦 [Cache] Successfully reconstructed meta for ${metaId} from ${availableComponents.length} components`);
  
  return { meta: reconstructedMeta };
}

/**
 * meta cache wrapper that tries component reconstruction first, then falls back to full generation
 * This provides granular caching with graceful degradation
 */
async function cacheWrapMetaSmart(userUUID, metaId, method, ttl = META_TTL, options = {}, type = null) {
   console.log(`📦 [Cache] Smart meta caching for ${metaId} (type: ${type})`);
   
   // First, try to reconstruct from cached components
   const reconstructedMeta = await reconstructMetaFromComponents(userUUID, metaId, ttl, options, type);
   
     if (reconstructedMeta && reconstructedMeta.meta) {
    return reconstructedMeta;
  }
   
   // If reconstruction failed, generate full meta and cache components
   console.log(`📦 [Cache] Component reconstruction failed for ${metaId}, generating full meta`);
   return await cacheWrapMetaComponents(userUUID, metaId, method, ttl, options, type);
}

/**
 * Simple component caching without validation
 * Used for individual meta components that don't need meta validation
 */
async function cacheComponent(cacheKey, componentData, ttl) {
  if (!redis || !componentData) return;
  
  try {
    await redis.set(cacheKey, JSON.stringify(componentData), 'EX', ttl);
  } catch (error) {
    console.warn(`📦 [Cache] Failed to cache component for ${cacheKey}:`, error);
  }
}

/**
 * Cache individual meta components during meta generation
 * This is used within getMeta functions to cache expensive components like videos, cast, etc.
 */
async function cacheMetaComponent(userUUID, metaId, componentName, componentData, ttl = META_TTL, type = null) {
  if (!redis || !componentData) return;
  
  try {
    // Load config from database
    let config;
    try {
      config = await loadConfigFromDatabase(userUUID);
    } catch (error) {
      console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
      return; // Skip caching for invalid UUIDs
    }
    
    if (!config) {
      console.warn(`[Cache] No config found for user ${userUUID}`);
      return;
    }
    
    // Parse metaId to determine context
    const [prefix, sourceId] = metaId.split(':');
    const metaType = type;
    
    // Create context-aware meta config object
    const metaConfig = {
      language: config.language || 'en-US',
      castCount: config.castCount || 0,
      blurThumbs: config.blurThumbs || false,
      showPrefix: config.showPrefix || false,
      showMetaProviderAttribution: config.showMetaProviderAttribution || false,
    };
    
    // Add context-specific settings
    const isAnime = prefix === 'mal' || prefix === 'kitsu' || prefix === 'anilist' || prefix === 'anidb' || metaType === 'anime';
    
    if (isAnime) {
      metaConfig.metaProvider = config.providers?.anime || 'mal';
      metaConfig.artProvider = {
       poster: resolveArtProvider('anime', 'poster', config),
       background: resolveArtProvider('anime', 'background', config),
       logo: resolveArtProvider('anime', 'logo', config)
     };
      metaConfig.animeIdProvider = config.providers?.anime_id_provider || 'imdb';
      metaConfig.mal = {
        skipFiller: config.mal?.skipFiller || false,
        skipRecap: config.mal?.skipRecap || false
      };
    } else if (metaType === 'movie') {
      metaConfig.metaProvider = config.providers?.movie || 'tmdb';
      metaConfig.artProvider = {
       poster: resolveArtProvider('movie', 'poster', config),
       background: resolveArtProvider('movie', 'background', config),
       logo: resolveArtProvider('movie', 'logo', config)
     };
    } else if (metaType === 'series') {
      metaConfig.metaProvider = config.providers?.series || 'tvdb';
      metaConfig.artProvider = {
       poster: resolveArtProvider('series', 'poster', config),
       background: resolveArtProvider('series', 'background', config),
       logo: resolveArtProvider('series', 'logo', config)
     };
      if (prefix === 'tvdb') {
        metaConfig.tvdbSeasonType = config.tvdbSeasonType || 'default';
      }
    }
    
    const metaConfigString = JSON.stringify(metaConfig);
    const cacheKey = `meta-${componentName}:${metaConfigString}:${metaId}`;
    
    // Cache the component
    await redis.set(cacheKey, JSON.stringify(componentData), 'EX', ttl);
    
  } catch (error) {
    console.warn(`📦 [Cache] Failed to cache component ${componentName} for ${metaId}:`, error);
  }
}

/**
 * Get cached meta component
 * This is used within getMeta functions to retrieve cached components
 */
async function getCachedMetaComponent(userUUID, metaId, componentName, type = null) {
  if (!redis) return null;
  
  try {
    // Load config from database
    let config;
    try {
      config = await loadConfigFromDatabase(userUUID);
    } catch (error) {
      console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
      return null; // Return null for invalid UUIDs
    }
    
    if (!config) {
      console.warn(`[Cache] No config found for user ${userUUID}`);
      return null;
    }
    
    // Parse metaId to determine context
    const [prefix, sourceId] = metaId.split(':');
    const metaType = type;
    
    // Create context-aware meta config object
    const metaConfig = {
      language: config.language || 'en-US',
      castCount: config.castCount || 0,
      blurThumbs: config.blurThumbs || false,
      showPrefix: config.showPrefix || false,
      showMetaProviderAttribution: config.showMetaProviderAttribution || false,
    };
    
    // Add context-specific settings
    const isAnime = prefix === 'mal' || prefix === 'kitsu' || prefix === 'anilist' || prefix === 'anidb' || metaType === 'anime';
    
    if (isAnime) {
      metaConfig.metaProvider = config.providers?.anime || 'mal';
      metaConfig.artProvider = {
       poster: resolveArtProvider('anime', 'poster', config),
       background: resolveArtProvider('anime', 'background', config),
       logo: resolveArtProvider('anime', 'logo', config)
     };
      metaConfig.animeIdProvider = config.providers?.anime_id_provider || 'imdb';
      metaConfig.mal = {
        skipFiller: config.mal?.skipFiller || false,
        skipRecap: config.mal?.skipRecap || false
      };
    } else if (metaType === 'movie') {
      metaConfig.metaProvider = config.providers?.movie || 'tmdb';
      metaConfig.artProvider = {
       poster: resolveArtProvider('movie', 'poster', config),
       background: resolveArtProvider('movie', 'background', config),
       logo: resolveArtProvider('movie', 'logo', config)
     };
    } else if (metaType === 'series') {
      metaConfig.metaProvider = config.providers?.series || 'tvdb';
      metaConfig.artProvider = {
       poster: resolveArtProvider('series', 'poster', config),
       background: resolveArtProvider('series', 'background', config),
       logo: resolveArtProvider('series', 'logo', config)
     };
      if (prefix === 'tvdb') {
        metaConfig.tvdbSeasonType = config.tvdbSeasonType || 'default';
      }
    }
    
    const metaConfigString = JSON.stringify(metaConfig);
    const cacheKey = `meta-${componentName}:${metaConfigString}:${metaId}`;
    
    // Get the cached component
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      //console.log(`📦 [Cache] Component HIT: ${componentName} for ${metaId}`);
      return parsed;
    } else {
      //console.log(`📦 [Cache] Component MISS: ${componentName} for ${metaId}`);
      return null;
    }
    
  } catch (error) {
    console.warn(`📦 [Cache] Failed to get cached component ${componentName} for ${metaId}:`, error);
    return null;
  }
}

function cacheWrapJikanApi(key, method) {
  const subkey = key.replace(/\s/g, '-');
  return cacheWrapGlobal(`jikan-api:${subkey}`, method, JIKAN_API_TTL);
}

async function cacheWrapStaticCatalog(userUUID, catalogKey, method, options = {}) {
  // Load config from database
  let config;
  try {
    config = await loadConfigFromDatabase(userUUID);
  } catch (error) {
    console.warn(`[Cache] Failed to load config for user ${userUUID}: ${error.message}`);
    // Return empty response for invalid UUIDs instead of crashing
    return { metas: [] };
  }
  
  if (!config) {
    console.warn(`[Cache] No config found for user ${userUUID}`);
    return { metas: [] };
  }
  
  const idOnly = catalogKey.split(':')[0];
  
  // Create context-aware catalog config (only relevant parameters for catalogs)
  const catalogConfig = {
    // Language (affects all catalogs)
    language: config.language || 'en-US',
    
    // Provider settings (affect catalog content)
    providers: config.providers || {},
    artProviders: config.artProviders || {},
    
    // Content filtering (affects catalog results)
    sfw: config.sfw || false,
    includeAdult: config.includeAdult || false,
    ageRating: config.ageRating || null,
    showPrefix: config.showPrefix || false,
    showMetaProviderAttribution: config.showMetaProviderAttribution || false,
    
    // Anime-specific settings (for MAL catalogs)
    mal: config.mal || {}
  };
  
  const catalogConfigString = JSON.stringify(catalogConfig);
  const key = `catalog:${catalogConfigString}:${catalogKey}`;
  
  console.log(`📦 [Cache] Static catalog cache key (${idOnly}): ${key.substring(0, 120)}...`);
  
  return cacheWrap(key, method, STATIC_CATALOG_TTL, options);
}

function cacheWrapTvdbApi(key, method) {
  // Custom result classifier for TVDB API - don't cache null results
  const tvdbResultClassifier = (result, error = null) => {
    if (error) {
      return classifyResult(result, error);
    }
    
    // Don't cache null results from TVDB API - let them retry immediately
    if (result === null || result === undefined) {
      console.log(`📦 [TVDB Cache] Skipping cache for null result: ${key}`);
      return { type: 'SKIP_CACHE', ttl: 0 };
    }
    
    return classifyResult(result, error);
  };

  return cacheWrapGlobal(`tvdb-api:${key}`, method, TVDB_API_TTL, {
    resultClassifier: tvdbResultClassifier
  });
}

function cacheWrapTvmazeApi(key, method) {
  return cacheWrapGlobal(`tvmaze-api:${key}`, method, TVMAZE_API_TTL);
}

/**
 * Get cache health statistics
 */
function getCacheHealth() {
  const total = cacheHealth.hits + cacheHealth.misses;
  return {
    hits: cacheHealth.hits,
    misses: cacheHealth.misses,
    errors: cacheHealth.errors,
    corruptedEntries: cacheHealth.corruptedEntries,
    hitRate: total > 0 ? ((cacheHealth.hits / total) * 100).toFixed(2) : '0.00',
    errorRate: total > 0 ? ((cacheHealth.errors / total) * 100).toFixed(2) : '0.00',
    totalRequests: total,
    mostAccessedKeys: Array.from(cacheHealth.keyAccessCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ key, count }))
  };
}

/**
 * Clear cache health statistics
 */
function clearCacheHealth() {
  cacheHealth.hits = 0;
  cacheHealth.misses = 0;
  cacheHealth.errors = 0;
  cacheHealth.corruptedEntries = 0;
  cacheHealth.errorCounts = {};
  cacheHealth.keyAccessCounts.clear();
  console.log('[Cache Health] Statistics cleared');
}

/**
 * Clear a specific cache key from Redis
 */
async function clearCache(key) {
  if (!redis) {
    console.warn('📦 [Cache] Redis not available, cannot clear cache');
    return;
  }
  
  try {
    const result = await redis.del(key);
    console.log(`📦 [Cache] Cleared key: ${key} (${result} keys removed)`);
    return result;
  } catch (error) {
    console.error(`📦 [Cache] Failed to clear key ${key}:`, error.message);
    throw error;
  }
}

module.exports = {
  redis,
  cacheWrap,
  cacheWrapGlobal,
  cacheWrapCatalog,
  cacheWrapSearch,
  cacheWrapJikanApi,
  cacheWrapStaticCatalog,
  cacheWrapMeta,
  cacheWrapMetaComponents,
  reconstructMetaFromComponents,
  cacheWrapMetaSmart,
  cacheMetaComponent,
  getCachedMetaComponent,
  getCacheHealth,
  clearCacheHealth,
  clearCache,
  logCacheHealth,
  cacheWrapTvdbApi,
  cacheWrapTvmazeApi
};