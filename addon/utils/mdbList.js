const axios = require("axios");
const { it } = require("node:test");
const { resolveAllIds } = require("../lib/id-resolver");
const Utils = require("./parseProps");
const moviedb = require("../lib/getTmdb");

const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;

async function fetchMDBListItems(listId, apiKey, language, page) {
    const offset = (page * 20) - 20;
  try {
    const url = `https://api.mdblist.com/lists/${listId}/items?language=${language}&limit=20&offset=${offset}&apikey=${apiKey}&append_to_response=genre,poster`;
    const response = await axios.get(url);
    return [
      ...(response.data.movies || []),
      ...(response.data.shows || [])
    ];
  } catch (err) {
    console.error("Error retrieving MDBList items:", err.message);
    return [];
  }
}

/**
 * Fetches batch media info from MDBList API for multiple IDs
 * Automatically handles batching for requests exceeding 200 items
 * @param {string} mediaProvider - The media provider (tmdb, imdb, trakt, tvdb, mal)
 * @param {string} mediaType - The media type (movie, show, any)
 * @param {Array<string>} ids - Array of IDs to fetch info for
 * @param {string} apiKey - MDBList API key
 * @param {Array<string>} appendToResponse - Optional array of additional data to append
 * @returns {Promise<Array>} Array of media info objects
 */
async function fetchMDBListBatchMediaInfo(mediaProvider, mediaType, ids, apiKey, appendToResponse = []) {
  if (!ids || ids.length === 0 || !apiKey) {
    console.warn("[MDBList] Missing required parameters for batch media info");
    return [];
  }

  const BATCH_SIZE = 200;
  const allResults = [];

  // Split IDs into batches of 200
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(ids.length / BATCH_SIZE);

    console.log(`[MDBList] Processing batch ${batchNumber}/${totalBatches} with ${batchIds.length} items`);

    try {
      const url = `https://api.mdblist.com/${mediaProvider}/${mediaType}?apikey=${apiKey}`;
      
      const requestBody = {
        ids: batchIds,
        append_to_response: appendToResponse
      };

      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout for batch requests
      });

      if (response.data && Array.isArray(response.data)) {
        console.log(`[MDBList] Batch ${batchNumber}/${totalBatches} successful: ${response.data.length} items`);
        allResults.push(...response.data);
      } else {
        console.warn(`[MDBList] Batch ${batchNumber}/${totalBatches} unexpected response format:`, response.data);
      }

    } catch (error) {
      console.error(`[MDBList] Error in batch ${batchNumber}/${totalBatches}:`, error.message);
      if (error.response) {
        console.error(`[MDBList] Response status: ${error.response.status}`);
        console.error(`[MDBList] Response data:`, error.response.data);
      }
      // Continue with next batch even if this one fails
    }

    // Add a small delay between batches to be respectful to the API
    if (i + BATCH_SIZE < ids.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[MDBList] Completed all batches. Total items fetched: ${allResults.length}`);
  return allResults;
}

async function getGenresFromMDBList(listId, apiKey) {
  try {
    const items = await fetchMDBListItems(listId, apiKey, 'en-US', 1);
    const genres = [
      ...new Set(
        items.flatMap(item =>
          (item.genre || []).map(g => {
            if (!g || typeof g !== "string") return null;
            return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
          })
        ).filter(Boolean)
      )
    ].sort();
    return genres;
  } catch(err) {
    console.error("ERROR in getGenresFromMDBList:", err);
    return [];
  }
}


async function parseMDBListItems(items, type, genreFilter, language, config) {
  let filteredItems = items;
  if (genreFilter) {
    filteredItems = filteredItems.filter(item =>
      Array.isArray(item.genre) &&
      item.genre.some(g => typeof g === "string" && g.toLowerCase() === genreFilter.toLowerCase())
    );
  }
  //console.log(`[MDBList] Filtered items: ${JSON.stringify(filteredItems)}`);

  const targetMediaType = type === 'series' ? 'show' : 'movie';
  const batchMediaInfo = await fetchMDBListBatchMediaInfo('tmdb', targetMediaType, filteredItems.map(item => item.id), config.apiKeys?.mdblist);
  //console.log(`[MDBList] Batch media info: ${JSON.stringify(batchMediaInfo)}`);
 
  const metas = await Promise.all(filteredItems
    .filter(item => item.mediatype === targetMediaType)
    .map(async item => {
      try {
        let allIds;
        let preferredProvider;
        if (type === 'movie') {
          preferredProvider = config.providers?.movie || 'tmdb';
        } else {
          preferredProvider = config.providers?.series || 'tvdb';
        }
        
        // Check all three art types and collect non-meta providers
        const posterProvider = Utils.resolveArtProvider(type, 'poster', config);
        const backgroundProvider = Utils.resolveArtProvider(type, 'background', config);
        const logoProvider = Utils.resolveArtProvider(type, 'logo', config);

        // Collect all unique non-meta providers
        const targetProviders = new Set();
        if (posterProvider !== preferredProvider && posterProvider !== 'tmdb' && posterProvider !== 'fanart') targetProviders.add(posterProvider);
        if (backgroundProvider !== preferredProvider && backgroundProvider !== 'tmdb' && backgroundProvider !== 'fanart') targetProviders.add(backgroundProvider);
        if (logoProvider !== preferredProvider && logoProvider !== 'tmdb' && logoProvider !== 'fanart') targetProviders.add(logoProvider);
        if (preferredProvider !== 'tmdb') targetProviders.add(preferredProvider);
        if ((posterProvider === 'fanart' || backgroundProvider === 'fanart' || logoProvider === 'fanart') && type === 'series') targetProviders.add('tvdb');

        let stremioId = `tmdb:${item.id}`;
        if (targetProviders.size > 0) {
          const targetProviderArray = Array.from(targetProviders);
          allIds = await resolveAllIds(`tmdb:${item.id}`, type, config, null, targetProviderArray);
        }

        if(preferredProvider === 'tvdb' && allIds?.tvdbId) {
          stremioId = `tvdb:${allIds.tvdbId}`;
        } else if(preferredProvider === 'tvmaze' && allIds?.tvmazeId) {
          stremioId = `tvmaze:${allIds.tvmazeId}`;
        } else if(preferredProvider === 'imdb' && allIds?.imdbId) {
          stremioId = allIds.imdbId;
        }

        const batchMediaItem = batchMediaInfo.find(media => media.ids?.tmdb === item.id);
        const posterPath = batchMediaItem?.poster || item.poster;
        const tmdbPosterFullUrl = posterPath 
          ? `https://image.tmdb.org/t/p/w500${posterPath}` 
          : `https://artworks.thetvdb.com/banners/images/missing/${type}.jpg`;
        let posterUrl = tmdbPosterFullUrl;
        if(allIds) {
          if (type === 'movie') {
            posterUrl = await Utils.getMoviePoster({
              tmdbId: item.id,
              tvdbId: allIds.tvdbId,
              imdbId: allIds.imdbId,
              metaProvider: preferredProvider,
              fallbackPosterUrl: tmdbPosterFullUrl
            }, config);
          } else {
            posterUrl = await Utils.getSeriesPoster({
              tmdbId: allIds.tmdbId,
              tvdbId: allIds.tvdbId,
              imdbId: allIds.imdbId,
              metaProvider: preferredProvider,
                fallbackPosterUrl: tmdbPosterFullUrl
              }, config);
          }
        }
        //console.log(`[MDBList] Batch media info: ${JSON.stringify(batchMediaInfo.find(media => media.id === item.id))}`);
        const posterProxyUrl = `${host}/poster/${type}/${stremioId}?fallback=${encodeURIComponent(posterUrl)}&lang=${language}&key=${config.apiKeys?.rpdb}`;
        //console.log (`[MDBList] ${JSON.stringify(item)}`);
        return {
          id: stremioId,
          type: type,
          imdb_id: allIds?.imdbId,
          name: item.title || item.name,
          poster: posterProxyUrl,
          logo: type === 'movie' ? await moviedb.getTmdbMovieLogo(item.id, config) : await moviedb.getTmdbSeriesLogo(item.id, config),
          description: Utils.addMetaProviderAttribution(batchMediaItem?.description || '', 'MDBList', config),
          runtime: Utils.parseRunTime(batchMediaItem?.runtime || null),
          imdbRating: String(batchMediaItem?.ratings?.find(rating => rating.source === 'imdb')?.value || 'N/A'),
          genres: item.genre || [],
          year: item.release_year || null,
          releaseInfo: item.release_year || null,
        };
      } catch (error) {
        console.error(`[MDBList] Error resolving IDs for item ${item.id}:`, error.message);
        const fallbackPosterUrl = item.poster ? `https://image.tmdb.org/t/p/w500${item.poster}` : `https://artworks.thetvdb.com/banners/images/missing/${type}.jpg`;
        const posterProxyUrl = `${host}/poster/${type}/tmdb:${item.id}?fallback=${encodeURIComponent(fallbackPosterUrl)}&lang=${language}&key=${config.apiKeys?.rpdb}`;
        return {
          id: `tmdb:${item.id}`,
          type: type,
          name: item.title || item.name,
          poster: posterProxyUrl,
          year: item.release_year || null,
          releaseInfo: item.release_year || null,
        };
      }
    }));

  return metas.filter(Boolean);
}

module.exports = { fetchMDBListItems, fetchMDBListBatchMediaInfo, getGenresFromMDBList, parseMDBListItems };
