const axios = require('axios');
const TVMAZE_API_URL = 'https://api.tvmaze.com';
const DEFAULT_TIMEOUT = 15000; // 15-second timeout for all requests
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

/**
 * Sleep function for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A helper to check for 404s and returns a specific value, otherwise logs the error.
 */
function handleAxiosError(error, context) {
  if (error.response && error.response.status === 404) {
    console.log(`${context}: Resource not found (404).`);
    return { notFound: true };
  }
  
  // Log network errors more concisely
  if (error.code === 'ETIMEDOUT' || error.code === 'ENETUNREACH' || error.code === 'ECONNREFUSED') {
    console.error(`${context}: Network error (${error.code}) - ${error.message}`);
  } else {
    console.error(`Error in ${context}:`, error.message || 'No error message available');
  }
  
  return { error: true };
}

/**
 * Retry wrapper for API calls
 */
async function retryApiCall(apiCall, context, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      const isLastAttempt = attempt === retries;
      const isRetryableError = error.code === 'ETIMEDOUT' || 
                              error.code === 'ENETUNREACH' || 
                              error.code === 'ECONNREFUSED' ||
                              (error.response && error.response.status >= 500);
      
      if (isLastAttempt || !isRetryableError) {
        const { notFound } = handleAxiosError(error, context);
        return notFound ? null : null;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
      console.log(`${context}: Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}


/**
 * Gets the basic show object from TVmaze using an IMDb ID.
 */
async function getShowByImdbId(imdbId) {
  const url = `${TVMAZE_API_URL}/lookup/shows?imdb=${imdbId}`;
  const context = `getShowByImdbId for IMDb ${imdbId}`;
  
  return await retryApiCall(async () => {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  }, context);
}

/**
 * Gets the full show details, including all episodes and cast, using a TVmaze ID.
 */
async function getShowDetails(tvmazeId) {
  const url = `${TVMAZE_API_URL}/shows/${tvmazeId}?embed[]=episodes&embed[]=cast&embed[]=crew`;
  const context = `getShowDetails for TVmaze ID ${tvmazeId}`;
  
  return await retryApiCall(async () => {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  }, context);
}

/**
 * Gets the full show namely to retrieve external ids, using a TVmaze ID.
 */
async function getShowById(tvmazeId) {
  const url = `${TVMAZE_API_URL}/shows/${tvmazeId}`;
  const context = `getShowById for TVmaze ID ${tvmazeId}`;
  
  return await retryApiCall(async () => {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  }, context);
}


/**
 * Searches for shows on TVmaze based on a query.
 */
async function searchShows(query) {
  const url = `${TVMAZE_API_URL}/search/shows?q=${encodeURIComponent(query)}`;
  const context = `searchShows for query "${query}"`;
  
  return await retryApiCall(async () => {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  }, context) || [];
}

/**
 * Gets the basic show object from TVmaze using a TVDB ID.
 */
async function getShowByTvdbId(tvdbId) {
  const url = `${TVMAZE_API_URL}/lookup/shows?thetvdb=${tvdbId}`;
  const context = `getShowByTvdbId for TVDB ${tvdbId}`;
  
  return await retryApiCall(async () => {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  }, context);
}

/**
 * Searches for people on TVmaze.
 */
async function searchPeople(query) {
  const url = `${TVMAZE_API_URL}/search/people?q=${encodeURIComponent(query)}`;
  const context = `searchPeople for person "${query}"`;
  
  return await retryApiCall(async () => {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  }, context) || [];
}

/**
 * Gets all cast credits for a person.
 */
async function getPersonCastCredits(personId) {
  const url = `${TVMAZE_API_URL}/people/${personId}/castcredits?embed=show`;
  const context = `getPersonCastCredits for person ID ${personId}`;
  
  return await retryApiCall(async () => {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
    return response.data;
  }, context) || [];
}

module.exports = {
  getShowByImdbId,
  getShowDetails,
  getShowByTvdbId,
  searchShows,
  searchPeople,
  getPersonCastCredits,
  getShowById
};