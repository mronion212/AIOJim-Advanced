const crypto = require('crypto');

const database = require('./database');

class ConfigApi {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await database.initialize();
    this.initialized = true;
  }

  // Validate required API keys
  validateRequiredKeys(config) {
    const requiredKeys = ['tmdb', 'tvdb'];
    const missingKeys = requiredKeys.filter(key => !config.apiKeys?.[key]);
    
    if (missingKeys.length > 0) {
      return {
        valid: false,
        missingKeys,
        message: `Missing required API keys: ${missingKeys.join(', ')}`
      };
    }
    
    return { valid: true };
  }

  // Save configuration with password
  async saveConfig(req, res) {
    try {
      await this.initialize();
      
      // Ensure body exists and is JSON
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid request body. Expected JSON.' });
      }

      const { config, password, userUUID: existingUUID, addonPassword } = req.body;
      
      if (!config) {
        return res.status(400).json({ error: 'Configuration data is required' });
      }

      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }

      // Check addon password if one is set
      if (process.env.ADDON_PASSWORD && process.env.ADDON_PASSWORD.length > 0) {
        if (!addonPassword || addonPassword !== process.env.ADDON_PASSWORD) {
          return res.status(401).json({ error: 'Invalid addon password. Contact the addon administrator.' });
        }
      }

      // Validate required API keys
      const validation = this.validateRequiredKeys(config);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: validation.message,
          missingKeys: validation.missingKeys
        });
      }

      // Use existing UUID if provided, otherwise generate a new one
      const userUUID = existingUUID || database.generateUserUUID();
      
      // Hash the password
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      
      // Add timestamp to track config changes
      const configWithTimestamp = {
        ...config,
        lastModified: Date.now()
      };
      
      // Get old config to compare changes
      let oldConfig = null;
      try {
        oldConfig = await database.getUserConfig(userUUID);
      } catch (error) {
        // User might not exist yet, that's fine
        console.log(`[ConfigApi] No existing config found for user ${userUUID}, treating as new config`);
      }
      
      // Add a config version that changes when config is updated
      // This helps with cache invalidation
      configWithTimestamp.configVersion = Date.now();
      
      await database.saveUserConfig(userUUID, passwordHash, configWithTimestamp);
      // Always trust the UUID after creation
      await database.trustUUID(userUUID);
      
      // Invalidate user's cache when config changes
      try {
        const redis = require('./getCache').redis;
        
        // Clear only the meta components affected by config changes
        try {
          const patterns = [];
          
          // Map config changes to specific cache components that need clearing
          // This ensures we only clear what's actually affected by the change
          
          // Cast-related changes
          if (config.castCount !== undefined && config.castCount !== oldConfig?.castCount) {
            patterns.push(`meta-cast:*`);  // Cast components
            patterns.push(`meta-videos:*`); // Episode components (might include cast info)
            console.log(`[ConfigApi] Cast count changed from ${oldConfig?.castCount} to ${config.castCount}`);
          }
          
          // Language changes - affects all meta content
          if (config.language !== undefined && config.language !== oldConfig?.language) {
            patterns.push(`v*:meta-*:*`); // All meta components since language affects everything
            patterns.push(`search:*`); // Also clear search cache since language affects search results
            console.log(`[ConfigApi] Language changed from ${oldConfig?.language} to ${config.language}`);
            console.log(`[ConfigApi] DEBUG: Added pattern "v*:meta-*:*" and "search:*" for language change`);
          }
          
          // Blur thumbs changes - affects poster/background display
          if (config.blurThumbs !== undefined && config.blurThumbs !== oldConfig?.blurThumbs) {
            patterns.push(`meta-poster:*`); // Poster components
            patterns.push(`meta-background:*`); // Background components
            patterns.push(`search:*`); // Also clear search cache since blur affects search results
            console.log(`[ConfigApi] Blur thumbs changed from ${oldConfig?.blurThumbs} to ${config.blurThumbs}`);
            console.log(`[ConfigApi] DEBUG: Added patterns for poster, background, and search cache for blur change`);
          }
          
          // Show prefix changes - affects basic meta display
          if (config.showPrefix !== undefined && config.showPrefix !== oldConfig?.showPrefix) {
            patterns.push(`meta-basic:*`); // Basic meta components
            patterns.push(`search:*`); // Also clear search cache since prefix affects search results
            console.log(`[ConfigApi] Show prefix changed from ${oldConfig?.showPrefix} to ${config.showPrefix}`);
            console.log(`[ConfigApi] DEBUG: Added patterns for basic meta and search cache for prefix change`);
          }
          
          // Art provider changes - affects all art-related components
          if (config.artProviders && oldConfig?.artProviders) {
            const artProvidersChanged = Object.keys(config.artProviders).some(key => {
              const newValue = config.artProviders[key];
              const oldValue = oldConfig.artProviders?.[key];
              
              // Handle englishArtOnly boolean property
              if (key === 'englishArtOnly') {
                return newValue !== oldValue;
              }
              
              // Handle legacy string format
              if (typeof newValue === 'string' && typeof oldValue === 'string') {
                return newValue !== oldValue;
              }
              
              // Handle new nested object format
              if (typeof newValue === 'object' && typeof oldValue === 'object') {
                return newValue.poster !== oldValue.poster || 
                       newValue.background !== oldValue.background || 
                       newValue.logo !== oldValue.logo;
              }
              
              // Handle mixed formats (legacy to new or vice versa)
              return true;
            });
            
            if (artProvidersChanged) {
              patterns.push(`meta:*`);
              patterns.push(`meta-*:*`);
              patterns.push(`search:*`);
              patterns.push(`catalog:*`);
              console.log(`[ConfigApi] Old art providers:`, oldConfig.artProviders);
              console.log(`[ConfigApi] New art providers:`, config.artProviders);
            }
          }
          
          // Meta provider changes - affects all components since it changes the data source
          if (config.providers && oldConfig?.providers) {
            console.log(`[ConfigApi] DEBUG: Comparing providers - old:`, oldConfig.providers, `new:`, config.providers);
            const providersChanged = Object.keys(config.providers).some(key => 
              config.providers[key] !== oldConfig.providers?.[key]
            );
            console.log(`[ConfigApi] DEBUG: Providers changed:`, providersChanged);
            if (providersChanged) {
              patterns.push(`meta:*`);
              patterns.push(`meta-*:*`);
              patterns.push(`search:*`);
              patterns.push(`catalog:*`);
            }
          } else {
            console.log(`[ConfigApi] DEBUG: No providers to compare - old:`, oldConfig?.providers, `new:`, config.providers);
          }
          
          // SFW mode changes
          if (config.sfw !== undefined && config.sfw !== oldConfig?.sfw) {
            // SFW affects content filtering, so clear all components
            patterns.push(`meta-*:*`); // All meta components
            patterns.push(`search:*`); // Also clear search cache since SFW affects search results
            console.log(`[ConfigApi] SFW mode changed from ${oldConfig?.sfw} to ${config.sfw}`);
            console.log(`[ConfigApi] DEBUG: Added patterns for meta and search cache for SFW change`);
          }
          
          // Search-specific changes - affects search results
          if (config.search && oldConfig?.search) {
            const searchProvidersChanged = config.search.providers && oldConfig.search.providers && 
              Object.keys(config.search.providers).some(key => 
                config.search.providers[key] !== oldConfig.search.providers?.[key]
              );
            const aiEnabledChanged = config.search.ai_enabled !== oldConfig.search.ai_enabled;
            
            if (searchProvidersChanged || aiEnabledChanged) {
              patterns.push(`search:*`); // Clear all search cache
              console.log(`[ConfigApi] Search settings changed, clearing search cache`);
              if (searchProvidersChanged) console.log(`[ConfigApi] Search providers changed`);
              if (aiEnabledChanged) console.log(`[ConfigApi] AI enabled changed from ${oldConfig.search.ai_enabled} to ${config.search.ai_enabled}`);
              console.log(`[ConfigApi] DEBUG: Added pattern "search:*" for search settings change`);
            }
          }
          
          // If no specific patterns identified, don't clear anything
          if (patterns.length === 0) {
            console.log(`[ConfigApi] No config changes detected, skipping cache clearing`);
          }
          
          let totalCleared = 0;
          
          // First try pattern-based clearing
          for (const pattern of patterns) {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
              console.log(`[ConfigApi] DEBUG: Found ${keys.length} keys matching pattern "${pattern}":`);
              keys.slice(0, 5).forEach(key => console.log(`[ConfigApi] DEBUG:   - ${key}`));
              if (keys.length > 5) console.log(`[ConfigApi] DEBUG:   ... and ${keys.length - 5} more`);
              
              await redis.del(...keys);
              totalCleared += keys.length;
              console.log(`[ConfigApi] Cleared ${keys.length} cache entries matching pattern: ${pattern}`);
            } else {
              console.log(`[ConfigApi] DEBUG: No keys found matching pattern "${pattern}"`);
            }
          }
          
          // If we have any config changes that affect meta, clear ALL cache for this user
          // This ensures we don't miss any cache entries and forces fresh data
          if (patterns.some(p => p.includes('meta-'))) {
            try {
              // Clear ALL cache entries for this user (nuclear option)
              const allKeys = await redis.keys(`meta-*:*`);
              console.log(`[ConfigApi] DEBUG: Nuclear option - Found ${allKeys.length} total meta keys:`);
              allKeys.slice(0, 10).forEach(key => console.log(`[ConfigApi] DEBUG:   - ${key}`));
              if (allKeys.length > 10) console.log(`[ConfigApi] DEBUG:   ... and ${allKeys.length - 10} more`);
              
              if (allKeys.length > 0) {
                await redis.del(...allKeys);
                totalCleared += allKeys.length;
                console.log(`[ConfigApi] NUCLEAR OPTION: Cleared ${allKeys.length} total meta cache entries for user`);
              }
              
              // Also try clearing with more specific patterns (matching actual cache key format)
              const specificPatterns = [
                `meta-basic:*`,
                `meta-poster:*`,
                `meta-background:*`,
                `meta-logo:*`,
                `meta-cast:*`,
                `meta-videos:*`,
                `meta-director:*`,
                `meta-writer:*`,
                `meta-links:*`,
                `meta-trailers:*`,
                `meta-extras:*`
              ];
              
              for (const pattern of specificPatterns) {
                const keys = await redis.keys(pattern);
                if (keys.length > 0) {
                  console.log(`[ConfigApi] DEBUG: Specific pattern "${pattern}" found ${keys.length} keys:`);
                  keys.slice(0, 3).forEach(key => console.log(`[ConfigApi] DEBUG:   - ${key}`));
                  if (keys.length > 3) console.log(`[ConfigApi] DEBUG:   ... and ${keys.length - 3} more`);
                  
                  await redis.del(...keys);
                  totalCleared += keys.length;
                  console.log(`[ConfigApi] Cleared ${keys.length} cache entries with pattern: ${pattern}`);
                } else {
                  console.log(`[ConfigApi] DEBUG: Specific pattern "${pattern}" found no keys`);
                }
              }
              
            } catch (fallbackError) {
              console.warn(`[ConfigApi] Fallback cache clearing failed:`, fallbackError.message);
            }
          }
          
          if (totalCleared > 0) {
            console.log(`[ConfigApi] Total affected cache cleared: ${totalCleared} entries`);
          } else {
            console.log(`[ConfigApi] No affected cache entries found to clear`);
          }
        } catch (cacheError) {
          console.warn(`[ConfigApi] Failed to clear affected cache:`, cacheError.message);
        }
        

      } catch (cacheError) {
        console.warn(`[ConfigApi] Failed to invalidate cache for user ${userUUID}:`, cacheError.message);
        // Don't fail the config save if cache invalidation fails
      }
      
      const hostEnv = process.env.HOST_NAME;
      const baseUrl = hostEnv
        ? (hostEnv.startsWith('http') ? hostEnv : `https://${hostEnv}`)
        : `https://${req.get('host')}`;

      const installUrl = `${baseUrl}/stremio/${userUUID}/manifest.json`;

      res.json({
        success: true,
        userUUID,
        installUrl,
        message: existingUUID ? 'Configuration updated successfully' : 'Configuration saved successfully'
      });
    } catch (error) {
      console.error('[ConfigApi] Save config error:', error);
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  }

  // Manual cache clearing endpoint (temporarily disabled)
  // async clearCache(req, res) { ... }

  // Load configuration by UUID (requires password)
  async loadConfig(req, res) {
    try {
      await this.initialize();
      const { userUUID } = req.params;
      const { password, addonPassword } = req.body;
      if (!userUUID) {
        return res.status(400).json({ error: 'User UUID is required' });
      }
      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }
      // Check if UUID is trusted
      const isTrusted = await database.isUUIDTrusted(userUUID);
      if (!isTrusted && process.env.ADDON_PASSWORD && process.env.ADDON_PASSWORD.length > 0) {
        if (!addonPassword || addonPassword !== process.env.ADDON_PASSWORD) {
          return res.status(401).json({ error: 'Invalid addon password. Contact the addon administrator.' });
        }
      }
      const config = await database.verifyUserAndGetConfig(userUUID, password);
      if (!config) {
        return res.status(401).json({ error: 'Invalid UUID or password' });
      }
      // If not already trusted and correct addon password was provided, trust this UUID
      if (!isTrusted && addonPassword && addonPassword === process.env.ADDON_PASSWORD) {
        await database.trustUUID(userUUID);
      }
      res.json({
        success: true,
        userUUID,
        config
      });
    } catch (error) {
      console.error('[ConfigApi] Load config error:', error);
      res.status(500).json({ error: 'Failed to load configuration' });
    }
  }

  // Update configuration (requires password)
  async updateConfig(req, res) {
    try {
      await this.initialize();
      
      const { userUUID } = req.params;
      const { config, password, addonPassword } = req.body;
      
      if (!userUUID) {
        return res.status(400).json({ error: 'User UUID is required' });
      }

      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }

      if (!config) {
        return res.status(400).json({ error: 'Configuration data is required' });
      }

      // Check if UUID is trusted
      const isTrusted = await database.isUUIDTrusted(userUUID);
      if (!isTrusted && process.env.ADDON_PASSWORD && process.env.ADDON_PASSWORD.length > 0) {
        if (!addonPassword || addonPassword !== process.env.ADDON_PASSWORD) {
          return res.status(401).json({ error: 'Invalid addon password. Contact the addon administrator.' });
        }
      }

      // Validate required API keys
      const validation = this.validateRequiredKeys(config);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: validation.message,
          missingKeys: validation.missingKeys
        });
      }

      // Verify existing config exists
      const existingConfig = await database.verifyUserAndGetConfig(userUUID, password);
      if (!existingConfig) {
        return res.status(401).json({ error: 'Invalid UUID or password' });
      }

      // Hash the password
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      
      // Update the configuration
      await database.saveUserConfig(userUUID, passwordHash, config);
      
      const hostEnv2 = process.env.HOST_NAME;
      const baseUrl2 = hostEnv2
        ? (hostEnv2.startsWith('http') ? hostEnv2 : `https://${hostEnv2}`)
        : `https://${req.get('host')}`;
      
      res.json({
        success: true,
        userUUID,
        installUrl: `${baseUrl2}/stremio/${userUUID}/manifest.json`,
        message: 'Configuration updated successfully'
      });
    } catch (error) {
      console.error('[ConfigApi] Update config error:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  }

  // Migrate from localStorage (for backward compatibility)
  async migrateFromLocalStorage(req, res) {
    try {
      await this.initialize();
      
      const { localStorageData, password } = req.body;
      
      if (!localStorageData) {
        return res.status(400).json({ error: 'localStorage data is required' });
      }

      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }

      const userUUID = await database.migrateFromLocalStorage(localStorageData, password);
      
      if (!userUUID) {
        return res.status(400).json({ error: 'Failed to migrate localStorage data' });
      }
      // Always trust the UUID after migration
      await database.trustUUID(userUUID);

      const config = await database.getUserConfig(userUUID);

      const hostEnv3 = process.env.HOST_NAME;
      const baseUrl3 = hostEnv3
        ? (hostEnv3.startsWith('http') ? hostEnv3 : `https://${hostEnv3}`)
        : `https://${req.get('host')}`;
      res.json({
        success: true,
        userUUID,
        installUrl: `${baseUrl3}/stremio/${userUUID}/manifest.json`,
        message: 'Migration completed successfully'
      });
    } catch (error) {
      console.error('[ConfigApi] Migration error:', error);
      res.status(500).json({ error: 'Failed to migrate data' });
    }
  }

  // Get database stats (admin endpoint)
  async getStats(req, res) {
    try {
      await this.initialize();
      
      const userConfigs = await database.allQuery('SELECT COUNT(*) as count FROM user_configs');

      res.json({
        success: true,
        stats: {
          userConfigs: userConfigs[0]?.count || 0
        }
      });
    } catch (error) {
      console.error('[ConfigApi] Get stats error:', error);
      res.status(500).json({ error: 'Failed to get database stats' });
    }
  }

  // Check if addon password is required
  async getAddonInfo(req, res) {
    try {
      const requiresAddonPassword = !!(process.env.ADDON_PASSWORD && process.env.ADDON_PASSWORD.length > 0);
      
      res.json({
        success: true,
        requiresAddonPassword,
        version: process.env.npm_package_version || '1.0.0'
      });
    } catch (error) {
      console.error('[ConfigApi] Get addon info error:', error);
      res.status(500).json({ error: 'Failed to get addon information' });
    }
  }

  // Check if a UUID is trusted and if addon password is required
  async isTrusted(req, res) {
    try {
      await this.initialize();
      const { uuid } = req.params;
      if (!uuid) return res.status(400).json({ error: 'UUID is required' });
      const trusted = await database.isUUIDTrusted(uuid);
      const requiresAddonPassword = !!(process.env.ADDON_PASSWORD && process.env.ADDON_PASSWORD.length > 0);
      res.json({ trusted, requiresAddonPassword });
    } catch (error) {
      console.error('[ConfigApi] isTrusted error:', error);
      res.status(500).json({ error: 'Failed to check trust status' });
    }
  }

  // Load configuration from database by UUID (for internal use)
  async loadConfigFromDatabase(userUUID) {
    try {
      await this.initialize();
      
      if (!userUUID) {
        throw new Error('userUUID is required');
      }

      const config = await database.getUserConfig(userUUID);
      if (!config) {
        throw new Error(`No configuration found for userUUID: ${userUUID}`);
      }

      return config;
    } catch (error) {
      console.error('[ConfigApi] loadConfigFromDatabase error:', error);
      throw error;
    }
  }

  // Get all ID mapping corrections (admin endpoint)
  async getCorrections(req, res) {
    try {
      const { loadCorrections } = require('./id-mapper');
      await loadCorrections();
      
      const fs = require('fs').promises;
      const path = require('path');
      const correctionsPath = path.join(__dirname, '..', 'data', 'id-mapping-corrections.json');
      
      try {
        const correctionsData = await fs.readFile(correctionsPath, 'utf-8');
        const corrections = JSON.parse(correctionsData);
        
        res.json({
          success: true,
          corrections
        });
      } catch (error) {
        if (error.code === 'ENOENT') {
          res.json({
            success: true,
            corrections: []
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('[ConfigApi] Get corrections error:', error);
      res.status(500).json({ error: 'Failed to get corrections' });
    }
  }

  // Add a new ID mapping correction (admin endpoint)
  async addCorrection(req, res) {
    try {
      const { addonPassword } = req.body;
      
      // Check addon password if one is set
      if (process.env.ADDON_PASSWORD && process.env.ADDON_PASSWORD.length > 0) {
        if (!addonPassword || addonPassword !== process.env.ADDON_PASSWORD) {
          return res.status(401).json({ error: 'Invalid addon password. Contact the addon administrator.' });
        }
      }

      const { type, sourceId, correctedField, correctedId, reason } = req.body;
      
      if (!type || !sourceId || !correctedField || !correctedId) {
        return res.status(400).json({ 
          error: 'Missing required fields: type, sourceId, correctedField, correctedId' 
        });
      }

      const { addCorrection } = require('./id-mapper');
      const success = await addCorrection({
        type,
        sourceId,
        correctedField,
        correctedId,
        reason
      });

      if (success) {
        res.json({
          success: true,
          message: 'Correction added successfully'
        });
      } else {
        res.status(500).json({ error: 'Failed to add correction' });
      }
    } catch (error) {
      console.error('[ConfigApi] Add correction error:', error);
      res.status(500).json({ error: 'Failed to add correction' });
    }
  }

  // Remove an ID mapping correction (admin endpoint)
  async removeCorrection(req, res) {
    try {
      const { addonPassword } = req.body;
      
      // Check addon password if one is set
      if (process.env.ADDON_PASSWORD && process.env.ADDON_PASSWORD.length > 0) {
        if (!addonPassword || addonPassword !== process.env.ADDON_PASSWORD) {
          return res.status(401).json({ error: 'Invalid addon password. Contact the addon administrator.' });
        }
      }

      const { type, sourceId, correctedField } = req.body;
      
      if (!type || !sourceId || !correctedField) {
        return res.status(400).json({ 
          error: 'Missing required fields: type, sourceId, correctedField' 
        });
      }

      const { removeCorrection } = require('./id-mapper');
      const success = await removeCorrection(type, sourceId, correctedField);

      if (success) {
        res.json({
          success: true,
          message: 'Correction removed successfully'
        });
      } else {
        res.status(404).json({ error: 'Correction not found' });
      }
    } catch (error) {
      console.error('[ConfigApi] Remove correction error:', error);
      res.status(500).json({ error: 'Failed to remove correction' });
    }
  }
}

const configApi = new ConfigApi();

module.exports = {
  saveConfig: configApi.saveConfig.bind(configApi),
  loadConfig: configApi.loadConfig.bind(configApi),
  updateConfig: configApi.updateConfig.bind(configApi),
  migrateFromLocalStorage: configApi.migrateFromLocalStorage.bind(configApi),
  getStats: configApi.getStats.bind(configApi),
  getAddonInfo: configApi.getAddonInfo.bind(configApi),
  isTrusted: configApi.isTrusted.bind(configApi),
  loadConfigFromDatabase: configApi.loadConfigFromDatabase.bind(configApi),
  getCorrections: configApi.getCorrections.bind(configApi),
  addCorrection: configApi.addCorrection.bind(configApi),
  removeCorrection: configApi.removeCorrection.bind(configApi)
};
