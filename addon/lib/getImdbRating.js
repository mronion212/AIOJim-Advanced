const axios = require('axios');

/**
 * Fetches the official IMDb rating for a given IMDb ID from Cinemeta. 
 * 
 * @param {string} imdbId - The IMDb ID of the movie or series (e.g., 'tt0133093').
 * @param {'movie'|'series'} type - The content type.
 * @returns {Promise<string|undefined>} The IMDb rating as a string (e.g., "8.7") or undefined if not found or on error.
 */
async function getImdbRating(imdbId, type) {
  if (!imdbId) {
    return undefined;
  }

  const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
  const backupUrl = `https://cinemeta-live.strem.io/meta/${type}/${imdbId}.json`;
  try {
    const response = await axios.get(url);
    const rating = response.data?.meta?.imdbRating;
    if (!rating) {
      const backupResponse = await axios.get(backupUrl);
      const backupRating = backupResponse.data?.meta?.imdbRating;
      return backupRating ? String(backupRating) : undefined;
    }
    return rating ? String(rating) : undefined;

  } catch (error) {
    console.warn(`Could not fetch IMDb rating for ${imdbId} from Cinemeta. Error: ${error.message}`);
    return undefined;
  }
}

module.exports = { getImdbRating };
