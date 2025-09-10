const Kitsu = require('kitsu');
const { cacheWrapGlobal } = require('./getCache');

// Initialize Kitsu client
const kitsu = new Kitsu();

/**
 * Searches Kitsu for anime by a text query.
 * @param {string} query - The name of the anime to search for.
 * @returns {Promise<Array>} A promise that resolves to an array of Kitsu anime resource objects.
 */
async function searchByName(query) {
  if (!query) return [];
  
  try {
    const response = await kitsu.fetch('anime', {
      filter: { text: query },
      page: { limit: 20 }
    });
    return response.data || [];
  } catch (error) {
    console.error(`[Kitsu Client] Error searching for "${query}":`, error.message);
    return [];
  }
}

/**
 * Fetches the full details for multiple anime by their Kitsu IDs in a single request.
 * @param {Array<string|number>} ids - An array of Kitsu IDs.
 * @returns {Promise<Array>} A promise that resolves to an array of Kitsu anime resource objects.
 */
async function getMultipleAnimeDetails(ids) {
  if (!ids || ids.length === 0) {
    return [];
  }
  
  try {
    console.log(`[Kitsu Client] Fetching details for IDs: ${ids.join(',')}`);
    
    // Use direct API call to bypass Kitsu library filter issues
    const axios = require('axios');
    const url = `https://kitsu.io/api/edge/anime?filter[id]=${ids.join(',')}`;
    
    console.log(`[Kitsu Client] Direct API URL: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json'
      },
      timeout: 10000
    });
    
    console.log(`[Kitsu Client] Direct API received ${response.data?.data?.length || 0} results`);
    const receivedIds = response.data?.data?.map(item => item.id) || [];
    console.log(`[Kitsu Client] Received IDs: ${receivedIds.join(',')}`);
    
    return response.data?.data || [];
    
  } catch (error) {
    console.error(`[Kitsu Client] Error fetching details for IDs ${ids.join(',')}:`, error.message);
    return [];
  }
}

/**
 * Fetches episode data for an anime by its Kitsu ID.
 * @param {string|number} kitsuId - The Kitsu anime ID.
 * @returns {Promise<Array>} A promise that resolves to an array of episode objects.
 */
async function getAnimeEpisodes(kitsuId) {
  if (!kitsuId) return [];
  
  const cacheKey = `kitsu-episodes:v2:${kitsuId}`;
  const cacheTTL = 3600; // 1 hour cache for episode data
  
  return cacheWrapGlobal(cacheKey, async () => {
    console.log(`[Kitsu Client] Fetching episodes for ID ${kitsuId}`);
    
    try {
      const params = {
        page: { limit: 20 }
      };
      
      const allEpisodes = await _fetchEpisodesRecursively(`anime/${kitsuId}/episodes`, params);
      console.log(`[Kitsu Client] Total episodes fetched: ${allEpisodes.length}`);
      return allEpisodes;
    } catch (error) {
      console.error(`[Kitsu Client] Error fetching episodes for ID ${kitsuId}:`, error.message);
      return [];
    }
  }, cacheTTL);
}

async function _fetchEpisodesRecursively(endpoint, params, offset = 0) {
  const currentParams = { 
    ...params, 
    page: { ...params.page, offset } 
  };
  
  const response = await kitsu.get(endpoint, { params: currentParams });
  
  if (response.links && response.links.next) {
    const nextOffset = offset + response.data.length;
    const nextEpisodes = await _fetchEpisodesRecursively(endpoint, params, nextOffset);
    return response.data.concat(nextEpisodes);
  }
  
  return response.data;
}

/**
 * Fetches detailed anime information including relationships and episodes.
 * @param {string|number} kitsuId - The Kitsu anime ID.
 * @returns {Promise<Object>} A promise that resolves to detailed anime object.
 */
async function getAnimeDetails(kitsuId) {
  if (!kitsuId) return null;
  
  try {
    const response = await kitsu.fetch('anime', {
      filter: { id: kitsuId },
      include: 'episodes,genres,mediaRelationships.destination'
    });
    
    return response.data[0] || null;
  } catch (error) {
    console.error(`[Kitsu Client] Error fetching anime details for ID ${kitsuId}:`, error.message);
    return null;
  }
}

module.exports = {
  searchByName,
  getMultipleAnimeDetails,
  getAnimeEpisodes,
  getAnimeDetails,
};