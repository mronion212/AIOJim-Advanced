const axios = require("axios");
const Utils = require("./parseProps");
const moviedb = require("../lib/getTmdb");
const tvdb = require("../lib/tvdb");
const imdb = require("../lib/imdb");
const idMapper = require("../lib/id-mapper");
const { to3LetterCode } = require("../lib/language-map");
const { getImdbRating } = require("../lib/getImdbRating");

const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;

/**
 * Fetches StremThru catalog items from a catalog URL
 * @param {string} catalogUrl - The full StremThru catalog URL
 * @param {string} language - Language code (e.g., 'en-US')
 * @param {number} skip - Skip value for pagination (0-based)
 * @param {boolean} supportsSkip - Whether the catalog supports skip parameter
 * @returns {Promise<Array>} Array of catalog items
 */
async function fetchStremThruCatalog(catalogUrl) {
  try {
    let url;
    try {
      url = new URL(catalogUrl);
    } catch (error) {
      // If catalogUrl is not a valid URL, try to construct it
      console.warn(`[StremThru] Invalid URL format: ${catalogUrl}, attempting to fix...`);
      url = new URL(catalogUrl.startsWith('http') ? catalogUrl : `https://${catalogUrl}`);
    }
    
    const response = await axios.get(url.toString(), {
      timeout: 30000,
      headers: {
        'User-Agent': 'aiometadata-addon/1.0'
      }
    });
    
    if (!response.data || !response.data.metas) {
      console.warn(`[StremThru] Invalid response format from ${url.toString()}`);
      return [];
    }
    
    console.log(`[✨ StremThru] Successfully fetched ${response.data.metas.length} items from catalog`);
    return response.data.metas;
  } catch (err) {
    console.error(`[StremThru] Error fetching catalog from ${catalogUrl}:`, err.message);
    return [];
  }
}

/**
 * Fetches available catalogs from a StremThru manifest
 * @param {string} manifestUrl - The StremThru manifest URL
 * @returns {Promise<Array>} Array of available catalogs
 */
async function fetchStremThruManifest(manifestUrl) {
  try {
    console.log(`[✨ StremThru] Fetching manifest from: ${manifestUrl}`);
    const response = await axios.get(manifestUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'aiometadata-addon/1.0'
      }
    });
    
    if (!response.data || !response.data.catalogs) {
      console.warn(`[StremThru] Invalid manifest format from ${manifestUrl}`);
      return [];
    }
    
    console.log(`[✨ StremThru] Successfully fetched ${response.data.catalogs.length} catalogs from manifest`);
    return response.data.catalogs;
  } catch (err) {
    console.error(`[StremThru] Error fetching manifest from ${manifestUrl}:`, err.message);
    return [];
  }
}

/**
 * Extracts genres from StremThru catalog items
 * @param {Array} items - Array of StremThru catalog items
 * @returns {Array<string>} Array of unique genres
 */
async function getGenresFromStremThruCatalog(items) {
  try {
    const genres = [
      ...new Set(
        items.flatMap(item =>
          (item.genres || []).map(g => {
            if (!g || typeof g !== "string") return null;
            return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
          })
        ).filter(Boolean)
      )
    ].sort();
    
    console.log(`[✨ StremThru] Extracted ${genres.length} unique genres from catalog`);
    return genres;
  } catch(err) {
    console.error("[StremThru] ERROR in getGenresFromStremThruCatalog:", err);
    return [];
  }
}

/**
 * Parses StremThru catalog items into Stremio format
 * @param {Array} items - Array of StremThru catalog items
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string} genreFilter - Optional genre filter
 * @param {string} language - Language code
 * @param {Object} config - Addon configuration
 * @returns {Promise<Array>} Array of parsed meta items
 */
async function parseStremThruItems(items, type, genreFilter, language, config) {
  let filteredItems = items;
  
  // Apply genre filter if specified
  if (genreFilter && genreFilter.toLowerCase() !== 'none') {
    filteredItems = filteredItems.filter(item =>
      Array.isArray(item.genres) &&
      item.genres.some(g => typeof g === "string" && g.toLowerCase() === genreFilter.toLowerCase())
    );
  }
  
  console.log(`[✨ StremThru] Processing ${filteredItems.length} items (type: ${type}, genre: ${genreFilter || 'all'})`);
  
  const metas = await Promise.all(filteredItems
    .map(async item => {
      try {
        let tmdbId, tvdbId, imdbId, kitsuId, malId, anidbId, anilistId = null;
        const [provider, id] = item.id.split(':');
        if (provider === 'tmdb') tmdbId = id;
        if (provider === 'tvdb') tvdbId = id;
        if (provider.startsWith('tt')) imdbId = id;
        if (provider === 'kitsu') kitsuId = id;
        if (provider === 'mal') malId = id;
        if (provider === 'anidb') anidbId = id;
        if (provider === 'anilist') anilistId = id;
        
        if (!provider || !id) {
          console.warn(`[StremThru] Invalid ID format: ${item.id}`);
          return null;
        }
        
        let rpdbItemId = null;
        if(provider === 'mal') {
          const mapping = idMapper.getMappingByMalId(id);
          if(mapping && mapping.themoviedb_id) {
            rpdbItemId = `tmdb:${mapping.themoviedb_id}`;
          }
        } else if(provider === 'kitsu') {
          const mapping = idMapper.getMappingByKitsuId(id);
          if(mapping && mapping.themoviedb_id) {
            rpdbItemId = `tmdb:${mapping.themoviedb_id}`;
          }
        } else if(provider === 'anidb') {
          const mapping = idMapper.getMappingByAnidbId(id);
          if(mapping && mapping.themoviedb_id) {
            rpdbItemId = `tmdb:${mapping.themoviedb_id}`;
          }
        } else if(provider === 'anilist') {
          const mapping = idMapper.getMappingByAnilistId(id);
          if(mapping && mapping.themoviedb_id) {
            rpdbItemId = `tmdb:${mapping.themoviedb_id}`;
          }
        } else {
          rpdbItemId = item.id;
        }
        // Handle poster URLs
        let posterUrl = item.poster;
        let posterProxyUrl = null;
        
        if (posterUrl && posterUrl.includes('rpdb')) {
          posterProxyUrl = posterUrl;
        } else {
          posterProxyUrl = `${host}/poster/${item.type}/${rpdbItemId}?fallback=${encodeURIComponent(posterUrl)}&lang=${language}&key=${config.apiKeys?.rpdb}`;
        }
        
        
        // Get logo if available
        let logo = null;
        let overview = null;
        let genres = null;
        let runtime = null;
        let name = null;
        let imdbRating = null;
        try {
            if(provider === 'tmdb') {
                if (item.type === 'movie') {
                   const itemDetails = await moviedb.movieInfo({ id: id, language, append_to_response: "external_ids" }, config);
                   overview = itemDetails?.overview;
                   genres = Utils.parseGenres(itemDetails?.genres);
                   runtime = itemDetails?.runtime;
                   name = itemDetails?.name;
                   imdbId = imdbId ?? itemDetails.external_ids?.imdb_id;
                   imdbRating = imdbId ? await getImdbRating(imdbId, 'movie') : null;
                   logo = await moviedb.getTmdbMovieLogo(id, config);
                } else {
                    const itemDetails = await moviedb.tvInfo({ id: id, language, append_to_response: "external_ids" }, config);
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.episode_run_time?.[0] ?? itemDetails?.last_episode_to_air?.runtime ?? itemDetails?.next_episode_to_air?.runtime ?? null;
                    name = itemDetails?.name;
                    imdbId = imdbId ?? itemDetails.external_ids?.imdb_id;
                    imdbRating = imdbId ? await getImdbRating(imdbId, 'series') : null;
                    logo = await moviedb.getTmdbSeriesLogo(id, config);
                }
            } else if(provider === 'tvdb') {
                if (item.type === 'movie') {
                    const itemDetails = await tvdb.getMovieExtended(id, config);
                    const langCode = language.split('-')[0];
                    const langCode3 = await to3LetterCode(langCode, config);
                    const nameTranslations = itemDetails.translations?.nameTranslations || [];
                    const overviewTranslations = itemDetails.translations?.overviewTranslations || [];
                    const translatedName = nameTranslations.find(t => t.language === langCode3)?.name
                              || nameTranslations.find(t => t.language === 'eng')?.name
                              || itemDetails.name;
                    overview = overviewTranslations.find(t => t.language === langCode3)?.overview
                    || overviewTranslations.find(t => t.language === 'eng')?.overview
                    || itemDetails.overview;
                    genres = itemDetails?.genres?.map(g => g.name) || [];
                    runtime = itemDetails?.runtime;
                    name = translatedName;
                    imdbId = imdbId ?? itemDetails.remoteIds?.find(id => id.sourceName === 'IMDB')?.id;
                    imdbRating = imdbId ? await getImdbRating(imdbId, 'movie') : null;
                    logo = await tvdb.getMovieLogo(id, config);
                } else {
                    const itemDetails = await tvdb.getSeriesExtended(id, config);
                    const langCode = language.split('-')[0];
                    const langCode3 = await to3LetterCode(langCode, config);
                    const nameTranslations = itemDetails.translations?.nameTranslations || [];
                    const overviewTranslations = itemDetails.translations?.overviewTranslations || [];
                    const translatedName = nameTranslations.find(t => t.language === langCode3)?.name
                              || nameTranslations.find(t => t.language === 'eng')?.name
                              || itemDetails.name;
                    overview = overviewTranslations.find(t => t.language === langCode3)?.overview
                    || overviewTranslations.find(t => t.language === 'eng')?.overview
                    || itemDetails.overview;
                    genres = itemDetails?.genres?.map(g => g.name) || [];
                    name = translatedName;
                    runtime = itemDetails?.averageRuntime;
                    imdbId = imdbId ?? itemDetails.remoteIds?.find(id => id.sourceName === 'IMDB')?.id;
                    imdbRating = imdbId ? await getImdbRating(imdbId, 'series') : null;
                    logo = await tvdb.getSeriesLogo(id, config);
                }
            } else if(provider.startsWith('tt')) {
                if (item.type === 'movie') {
                    const itemDetails = await imdb.getMetaFromImdb(id, item.type);
                    runtime = itemDetails?.runtime;
                    logo = itemDetails?.logo;

                } else {
                    const itemDetails = await imdb.getMetaFromImdb(id, item.type);
                    runtime = itemDetails?.runtime;
                    logo = itemDetails?.logo;
                }
            } else if(provider === 'kitsu') {
                const mapping = idMapper.getMappingByKitsuId(id);
                if(mapping && mapping.themoviedb_id) {
                  if(item.type === 'movie') {
                    const itemDetails = await moviedb.movieInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.imdb_id || mapping.themoviedb_id, 'movie');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.runtime;
                    logo = await moviedb.getTmdbMovieLogo(mapping.themoviedb_id, config);
                  } else {
                    const itemDetails = await moviedb.tvInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.external_ids.imdb_id || mapping.themoviedb_id, 'series');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.episode_run_time?.[0] ?? itemDetails?.last_episode_to_air?.runtime ?? itemDetails?.next_episode_to_air?.runtime ?? null;
                    logo = await moviedb.getTmdbSeriesLogo(mapping.themoviedb_id, config);
                  }
                }
            }else if(provider === 'mal') {
                const mapping = idMapper.getMappingByMalId(id);
                if(mapping && mapping.themoviedb_id) {
                  if(item.type === 'movie') {
                    const itemDetails = await moviedb.movieInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.imdb_id || mapping.themoviedb_id, 'movie');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.runtime;
                    logo = await moviedb.getTmdbMovieLogo(mapping.themoviedb_id, config);
                  } else {
                    const itemDetails = await moviedb.tvInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.external_ids.imdb_id || mapping.themoviedb_id, 'series');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.episode_run_time?.[0] ?? itemDetails?.last_episode_to_air?.runtime ?? itemDetails?.next_episode_to_air?.runtime ?? null;
                    logo = await moviedb.getTmdbSeriesLogo(mapping.themoviedb_id, config);
                  }
                }
            } else if(provider === 'anidb') {
                const mapping = idMapper.getMappingByAnidbId(id);
                if(mapping && mapping.themoviedb_id) {
                  if(item.type === 'movie') {
                    const itemDetails = await moviedb.movieInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.imdb_id || mapping.themoviedb_id, 'movie');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.runtime;
                    logo = await moviedb.getTmdbMovieLogo(mapping.themoviedb_id, config);
                  } else {
                    const itemDetails = await moviedb.tvInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.external_ids.imdb_id || mapping.themoviedb_id, 'series');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.episode_run_time?.[0] ?? itemDetails?.last_episode_to_air?.runtime ?? itemDetails?.next_episode_to_air?.runtime ?? null;
                    logo = await moviedb.getTmdbSeriesLogo(mapping.themoviedb_id, config);
                  }
                }
            }
            else if(provider === 'anilist') {
                const mapping = idMapper.getMappingByAnilistId(id);
                if(mapping && mapping.themoviedb_id) {
                  if(item.type === 'movie') {
                    const itemDetails = await moviedb.movieInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.imdb_id || mapping.themoviedb_id, 'movie');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.runtime;
                    logo = await moviedb.getTmdbMovieLogo(mapping.themoviedb_id, config);
                  } else {
                    const itemDetails = await moviedb.tvInfo({ id: mapping.themoviedb_id, language, append_to_response: "external_ids" }, config);
                    imdbRating = await getImdbRating(itemDetails.external_ids.imdb_id || mapping.themoviedb_id, 'series');
                    name = itemDetails?.name;
                    overview = itemDetails?.overview;
                    genres = Utils.parseGenres(itemDetails?.genres);
                    runtime = itemDetails?.episode_run_time?.[0] ?? itemDetails?.last_episode_to_air?.runtime ?? itemDetails?.next_episode_to_air?.runtime ?? null;
                    logo = await moviedb.getTmdbSeriesLogo(mapping.themoviedb_id, config);
                  }
                }
            }
        } catch (logoError) {
          console.warn(`[StremThru] Could not fetch logo for ${item.id}:`, logoError.message);
        }


        
        

        // Handle year/release info
        let year = null;
        let releaseInfo = null;
        if (item.releaseInfo) {
          year = item.releaseInfo;
          releaseInfo = item.releaseInfo;
        }
        
        const meta = {
          id: item.id,
          type: item.type,
          name: name || item.name,
          poster: posterProxyUrl,
          logo: logo,
          description: Utils.addMetaProviderAttribution(overview || item.description || '', provider, config),
          imdbRating: imdbRating || item.imdbRating,
          genres: genres || item.genres || [],
          year: year,
          releaseInfo: releaseInfo,
          trailers: item.trailers || []
        };
        if (runtime) {
          meta.runtime = Utils.parseRunTime(runtime);
        }
        return meta;
      } catch (error) {
        console.error(`[StremThru] Error processing item ${item.id}:`, error.message);
        
        // Return fallback item with basic info
        const fallbackPosterUrl = item.poster || `https://artworks.thetvdb.com/banners/images/missing/${type}.jpg`;
        const posterProxyUrl = `${host}/poster/${type}/${item.id}?fallback=${encodeURIComponent(fallbackPosterUrl)}&lang=${language}&key=${config.apiKeys?.rpdb}`;
        
        return {
          id: item.id,
          type: item.type,
          name: item.name,
          poster: posterProxyUrl,
          description: item.description || '',
          genres: item.genres || [],
          year: item.releaseInfo || null,
          releaseInfo: item.releaseInfo || null,
          background: item.background || null,
          imdbRating: item.imdbRating || null,
          trailers: item.trailers || []
        };
      }
    }));
  
  const validMetas = metas.filter(Boolean);
  console.log(`[✨ StremThru] Successfully parsed ${validMetas.length}/${filteredItems.length} items`);
  
  return validMetas;
}

module.exports = { 
  fetchStremThruCatalog, 
  fetchStremThruManifest, 
  getGenresFromStremThruCatalog, 
  parseStremThruItems 
};
