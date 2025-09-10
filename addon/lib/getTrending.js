require("dotenv").config();
const moviedb = require("./getTmdb");
const Utils = require('../utils/parseProps');
const { resolveAllIds } = require('./id-resolver');
const { getImdbRating } = require('./getImdbRating');
//const { isAnime } = require("../utils/isAnime");
//const { getGenreList } = require('./getGenreList');

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;

async function getTrending(type, language, page, genre, config, userUUID) {
  const startTime = performance.now();
  try {
    console.log(`[getTrending] Fetching trending for type=${type}, language=${language}, page=${page}, genre=${genre}`);
    const media_type = type === "series" ? "tv" : type;
    const time_window = genre && ['day', 'week'].includes(genre.toLowerCase()) ? genre.toLowerCase() : "day";
    
    const parameters = { media_type, time_window, language, page };
    //const genreList = await getGenreList(language, type);
    
    const tmdbStartTime = performance.now();
    const res = await moviedb.trending(parameters, config);
    const tmdbTime = performance.now() - tmdbStartTime;
    console.log(`[getTrending] TMDB trending fetch took ${tmdbTime.toFixed(2)}ms`);
    const metasStartTime = performance.now();
    const metas = await Promise.all(res.results.map(async item => {
      const itemDetails = type === 'movie' ? await moviedb.movieInfo({ id: item.id, language, append_to_response: "external_ids" }, config) : await moviedb.tvInfo({ id: item.id, language, append_to_response: "external_ids" }, config);
      const certifications = type === 'movie' ? await moviedb.getMovieCertifications({ id: item.id }, config) : await moviedb.getTvCertifications({ id: item.id }, config);
      const runtime = type === 'movie' ? itemDetails?.runtime || null : itemDetails?.episode_run_time?.[0] ?? itemDetails?.last_episode_to_air?.runtime ?? itemDetails?.next_episode_to_air?.runtime ?? null;
      const year = type === 'movie' ? itemDetails?.release_date ? itemDetails.release_date.substring(0, 4) : "" : itemDetails?.first_air_date ? itemDetails.first_air_date.substring(0, 4) : "";
      // Determine preferred meta provider
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

      let allIds;
      let stremioId = `tmdb:${item.id}`;
      if (targetProviders.size > 0) {
        const targetProviderArray = Array.from(targetProviders);
        allIds = await resolveAllIds(`tmdb:${item.id}`, type, config, null, targetProviderArray);
      }
      
      // AIOJim Advanced: Always use IMDb ID as primary identifier for maximum compatibility
      if (allIds?.imdbId) {
        stremioId = allIds.imdbId; // Use IMDb ID as primary identifier
      } else if(preferredProvider === 'tvdb' && allIds?.tvdbId) {
        stremioId = `tvdb:${allIds.tvdbId}`;
      } else if(preferredProvider === 'tvmaze' && allIds?.tvmazeId) {
        stremioId = `tvmaze:${allIds.tvmazeId}`;
      } else if(preferredProvider === 'imdb' && allIds?.imdbId) {
        stremioId = allIds.imdbId;
      }

      const tmdbLogoUrl = type === 'movie' ? await moviedb.getTmdbMovieLogo(item.id, config) : await moviedb.getTmdbSeriesLogo(item.id, config);
      const tmdbPosterFullUrl = item.poster_path
        ? `${TMDB_IMAGE_BASE}${item.poster_path}`
        : `https://artworks.thetvdb.com/banners/images/missing/series.jpg`;
      let posterUrl = tmdbPosterFullUrl;
      if(allIds) {
        if (type === 'movie') {
          posterUrl = await Utils.getMoviePoster({
            tmdbId: allIds.tmdbId,
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
      const imdbRating = await getImdbRating(itemDetails?.imdb_id || itemDetails?.external_ids?.imdb_id || null, type);
      const posterProxyUrl = `${host}/poster/${type}/${`tmdb:${item.id}`}?fallback=${encodeURIComponent(posterUrl)}&lang=${language}&key=${config.apiKeys?.rpdb}`;
      return {
        id: stremioId,
        imdbId: itemDetails?.imdb_id || itemDetails?.external_ids?.imdb_id || null,
        type: type,
        logo: tmdbLogoUrl,
        description: itemDetails?.overview || '',
        runtime: Utils.parseRunTime(runtime),
        genres: Utils.parseGenres(itemDetails.genres),
        year: year,
        releaseInfo: year,
        name: item.title || item.name,
        poster: posterProxyUrl,
        certification: type === 'movie' ? Utils.getTmdbMovieCertificationForCountry(certifications) : Utils.getTmdbTvCertificationForCountry(certifications),
        country: Utils.parseCoutry(itemDetails.production_countries),
        imdbRating: imdbRating,
      };
    }));
    const metasTime = performance.now() - metasStartTime;
    console.log(`[getTrending] ${metas.length} Metas processing took ${metasTime.toFixed(2)}ms`);


    const movieRatingHierarchy = ['G', 'PG', 'PG-13', 'R', 'NC-17'];
    const tvRatingHierarchy = ["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"];
    
    // Pre-compute rating mappings and indices for performance
    const movieToTvMap = {
      'G': 'TV-G',
      'PG': 'TV-PG', 
      'PG-13': 'TV-14',
      'R': 'TV-MA',
      'NC-17': 'TV-MA'
    };
    
    const userRating = config.ageRating;
    let filteredMetas = metas;
    
    if (userRating && userRating.toLowerCase() !== 'none') {
      const isTvRating = type === 'series';
      const finalUserRating = isTvRating ? (movieToTvMap[userRating] || userRating) : userRating;
      const ratingHierarchy = isTvRating ? tvRatingHierarchy : movieRatingHierarchy;
      const userRatingIndex = ratingHierarchy.indexOf(finalUserRating);
      const filterStartTime = performance.now();
      filteredMetas = metas.filter(meta => {
        
        if (!meta.certification) {
          return true;
        }
        
        const resultRatingIndex = ratingHierarchy.indexOf(meta.certification);
        if (userRatingIndex !== -1 && resultRatingIndex !== -1) {
          return resultRatingIndex <= userRatingIndex;
        }
        
        // If result rating is not in hierarchy (like NR), filter it out when age filtering is enabled
        if (resultRatingIndex === -1) {
          return false;
        }
        
        return true;
      });
      
      const filterTime = performance.now() - filterStartTime;
      console.log(`[getTrending] ${filteredMetas.length} Age rating filtering took ${filterTime.toFixed(2)}ms`);
    } else {
      console.log(`[getTrending] No age rating filtering applied (ageRating: ${userRating})`);
    }
    
    const totalTime = performance.now() - startTime;
    console.log(`[getTrending] Total function execution took ${totalTime.toFixed(2)}ms`);
    
    return { metas: filteredMetas };

  } catch (error) {
    console.error(`Error fetching trending for type=${type}:`, error.message);
    return { metas: [] };
  }
}

module.exports = { getTrending };
