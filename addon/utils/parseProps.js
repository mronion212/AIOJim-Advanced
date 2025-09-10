const { decompressFromEncodedURIComponent } = require('lz-string');
const axios = require('axios');
const fanart = require('./fanart');
const anilist = require('../lib/anilist');
const tvdb = require('../lib/tvdb');
const tmdb = require('../lib/getTmdb');
const imdb = require('../lib/imdb');
const { resolveAllIds } = require('../lib/id-resolver');
const idMapper = require('../lib/id-mapper');
const { selectFanartImageByLang } = require('./fanart');
const { getImdbRating } = require('../lib/getImdbRating');

const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;

function normalize(str) {
  return str
    .normalize("NFD") //seperate letters from accents
    .replace(/[\u0300-\u036f]/g, "") //Remove accents, tildes, etc
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")  // Remove everything except letters, numbers, and whitespace
    .replace(/^the\s+/, "")  //skip 'the' article *experimental*
    .trim();
}

function sortSearchResults(results, query) {
  const normalizedQuery = normalize(query);
  
  results.sort((a, b) => {
    const titleA = normalize(a.name || '');
    const titleB = normalize(b.name || '');
    
    // Exact match priority (only if popularity > 3.5)
    const minPopularityForExactMatch = 3.5;
    const scoreA = a.popularity || a.score || 0;
    const scoreB = b.popularity || b.score || 0;
    
    if (titleA === normalizedQuery && titleB !== normalizedQuery && scoreA > minPopularityForExactMatch) return -1;
    if (titleA !== normalizedQuery && titleB === normalizedQuery && scoreB > minPopularityForExactMatch) return 1;
    
    // Starts with query priority
    const startsWithA = titleA.startsWith(normalizedQuery);
    const startsWithB = titleB.startsWith(normalizedQuery);
    if (startsWithA && !startsWithB) return -1;
    if (!startsWithA && startsWithB) return 1;
    
    // Score/popularity priority
    if (scoreA !== scoreB) return scoreB - scoreA;
    
    // Year priority (newer first)
    const yearA = parseInt(a.year, 10) || 0;
    const yearB = parseInt(b.year, 10) || 0;
    if (yearA !== yearB) return yearB - yearA;
    
    return 0;
  });
  
  return results;
}

function parseMedia(el, type, genreList = [], config = {}) {
  const genres = Array.isArray(el.genre_ids)
    ? el.genre_ids.map(genreId => (genreList.find((g) => g.id === genreId) || {}).name).filter(Boolean)
    : [];

  return {
    id: `tmdb:${el.id}`,
    name: type === 'movie' ? el.title : el.name,
    genre: genres,
    poster: el.poster_path ? `https://image.tmdb.org/t/p/w500${el.poster_path}` : null,
    background: el.backdrop_path ? `https://image.tmdb.org/t/p/original${el.backdrop_path}` : null,
    posterShape: "regular",
    imdbRating: el.vote_average ? el.vote_average.toFixed(1) : 'N/A',
    year: type === 'movie' ? (el.release_date?.substring(0, 4) || '') : (el.first_air_date?.substring(0, 4) || ''),
    type: type === 'movie' ? type : 'series',
    description: addMetaProviderAttribution(el.overview, 'TMDB', config),
  };
}

// Helper function to add meta provider attribution to overview
const addMetaProviderAttribution = (overview, provider, config) => {
  // Check if meta provider attribution is enabled
  if (!config?.showMetaProviderAttribution) {
    return overview;
  }
  
  if (!overview) return `[Meta provided by ${provider}]`;
  return `${overview}\n\n[Meta provided by ${provider}]`;
};


function parseCast(credits, count, metaProvider = 'tmdb') {
  if (!credits || !Array.isArray(credits.cast)) return [];
  const cast = credits.cast;
  const toParse = count === undefined || count === null ? cast : cast.slice(0, count);

  return toParse.map((el) => {
    let photoUrl = null;
    if (metaProvider === 'tmdb') {
      if (el.profile_path) {
        if (el.profile_path.startsWith('http')) {
          photoUrl = el.profile_path;
        } else {
            photoUrl = `https://image.tmdb.org/t/p/w276_and_h350_face${el.profile_path}`;
        }
      }
    }
    else {
      photoUrl = el.photo;
    }
    return {
      name: el.name,
      character: el.character,
      photo: photoUrl
    };
  });
}

function parseDirector(credits) {
  if (!credits || !Array.isArray(credits.crew)) return [];
  return credits.crew.filter((x) => x.job === "Director").map((el) => el.name);
}

function parseWriter(credits) {
    if (!credits || !Array.isArray(credits.crew)) return [];
    const writers = credits.crew.filter((x) => x.department === "Writing").map((el) => el.name);
    const creators = credits.crew.filter((x) => x.job === "Creator").map((el) => el.name);
    return [...new Set([...writers, ...creators])];
}

function parseSlug(type, title, imdbId, uniqueIdFallback = null) {
  const safeTitle = (title || '')
    .toLowerCase()
    .replace(/ /g, "-");

  let identifier = '';
  if (imdbId) {
    identifier = imdbId.replace('tt', '');
  } else if (uniqueIdFallback) {
    identifier = String(uniqueIdFallback);
  }

  return identifier ? `${type}/${safeTitle}-${identifier}` : `${type}/${safeTitle}`;
}

function parseTrailers(videos) {
    if (!videos || !Array.isArray(videos.results)) return [];
    return videos.results
        .filter((el) => el.site === "YouTube" && el.type === "Trailer")
        .map((el) => ({ source: el.key, type: el.type, name: el.name, ytId: el.key, lang: el.iso_639_1 }));
}

function parseTrailerStream(videos) {
    if (!videos || !Array.isArray(videos.results)) return [];
    return videos.results
        .filter((el) => el.site === "YouTube" && el.type === "Trailer")
        .map((el) => ({ title: el.name, ytId: el.key, lang: el.iso_639_1 }));
}

function parseImdbLink(vote_average, imdb_id) {
  return {
    name: vote_average,
    category: "imdb",
    url: `https://imdb.com/title/${imdb_id}`,
  };
}

function parseShareLink(title, imdb_id, type) {
  return {
    name: title,
    category: "share",
    url: `https://www.strem.io/s/${parseSlug(type, title, imdb_id)}`,
  };
}

function parseAnimeGenreLink(genres, type, userUUID) {
  if (!Array.isArray(genres) || !process.env.HOST_NAME) return [];
  
  const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;
    
  const manifestPath = userUUID ? `stremio/${userUUID}/manifest.json` : 'manifest.json';
  const manifestUrl = `${host}/${manifestPath}`;  

  return genres.map((genre) => {
    if (!genre || !genre.name) return null;

    let searchUrl;
    const genreId = genre.mal_id;
    if (!genreId) return null;
    let url = `stremio:///discover/${encodeURIComponent(
      manifestUrl
    )}/anime/mal.genres?genre=${genre.name}`;
    if (type === 'movie') {
      url += `&type_filter=movie`;
    } else if (type === 'series') {
      url += `&type_filter=tv`;
    }
    searchUrl = url;

    return {
      name: genre.name,
      category: "Genres",
      url: searchUrl,
    };
  }).filter(Boolean);
}

function parseGenreLink(genres, type, userUUID, isTvdb = false) {
  if (!Array.isArray(genres) || !process.env.HOST_NAME) return [];
  
  const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;
    
  const manifestPath = userUUID ? `stremio/${userUUID}/manifest.json` : 'manifest.json';
  const manifestUrl = `${host}/${manifestPath}`;

  return genres.map((genre) => {
    if (!genre || !genre.name) return null;

    let searchUrl;
    if (isTvdb) {
      searchUrl = `stremio:///discover/${encodeURIComponent(
        manifestUrl
      )}/${type}/tvdb.genres?genre=${encodeURIComponent(
        genre.name
      )}`;
    } else {
      searchUrl = `stremio:///discover/${encodeURIComponent(
        manifestUrl
      )}/${type}/tmdb.top?genre=${encodeURIComponent(
        genre.name
      )}`;
    }

    return {
      name: genre.name,
      category: "Genres",
      url: searchUrl,
    };
  }).filter(Boolean);
}

function parseCreditsLink(credits, castCount, metaProvider = 'tmdb') {
  const castData = parseCast(credits, castCount, metaProvider);
  const Cast = castData.map((actor) => ({
    name: actor.name, category: "Cast", url: `stremio:///search?search=${encodeURIComponent(actor.name)}`
  }));
  const Director = parseDirector(credits).map((director) => ({
    name: director, category: "Directors", url: `stremio:///search?search=${encodeURIComponent(director)}`,
  }));
  const Writer = parseWriter(credits).map((writer) => ({
    name: writer, category: "Writers", url: `stremio:///search?search=${encodeURIComponent(writer)}`,
  }));
  return [...Cast, ...Director, ...Writer];
}



function buildLinks(imdbRating, imdbId, title, type, genres, credits, language, castCount, userUUID, isTvdb = false, metaProvider = 'tmdb') {
  const links = [];

  if (imdbId) {
    links.push(parseImdbLink(imdbRating, imdbId));
    links.push(parseShareLink(title, imdbId, type));
  }

  const genreLinks = parseGenreLink(genres, type, userUUID, isTvdb);
  if (genreLinks.length > 0) {
    links.push(...genreLinks);
  }

  const creditLinks = parseCreditsLink(credits, castCount, metaProvider);
  if (creditLinks.length > 0) {
    links.push(...creditLinks);
  }
  return links.filter(Boolean);
}


function parseCoutry(production_countries) {
  return production_countries?.map((country) => country.name).join(", ") || '';
}

function parseGenres(genres) {
  return genres?.map((el) => el.name) || [];
}

function parseYear(status, first_air_date, last_air_date) {
  const startYear = first_air_date ? first_air_date.substring(0, 4) : '';
  if (status === "Ended" && last_air_date) {
    const endYear = last_air_date.substring(0, 4);
    return startYear === endYear ? startYear : `${startYear}-${endYear}`;
  }
  return startYear;
}


function parseAnimeCreditsLink(characterData, userUUID, castCount) {
  if (!characterData || !characterData.length === 0) return [];

  const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;
    
  const manifestPath = userUUID ? `stremio/${userUUID}/manifest.json` : 'manifest.json';
  const manifestUrl = `${host}/${manifestPath}`;

  const voiceActorLinks = characterData.slice(0, castCount).map(charEntry => {
    const voiceActor = charEntry.voice_actors.find(va => va.language === 'Japanese');
    if (!voiceActor) return null;

    const vaMalId = voiceActor.person.mal_id;

    const searchUrl = `stremio:///discover/${encodeURIComponent(
      manifestUrl
    )}/anime/mal.va_search?va_id=${vaMalId}`;

    return {
      name: voiceActor.person.name,
      category: 'Cast',
      url: searchUrl
    };
  }).filter(Boolean);

  return [...voiceActorLinks];
}

function getTmdbMovieCertificationForCountry(certificationsData) {
  const countryData = certificationsData.results?.find(r => r.iso_3166_1 === 'US');
  if (!countryData?.release_dates) return null;
  
  // Step 1: Find the most recent theatrical release with non-empty certification
  const theatricalWithCert = countryData.release_dates
    .filter(rd => rd.type === 3 && rd.certification && rd.certification.trim() !== '')
    .sort((a, b) => new Date(b.release_date) - new Date(a.release_date));
  
  if (theatricalWithCert.length > 0) {
    return theatricalWithCert[0].certification;
  }
  
  // Step 2: If no theatrical releases have certification, find any release with certification data
  const anyWithCert = countryData.release_dates
    .filter(rd => rd.certification && rd.certification.trim() !== '')
    .sort((a, b) => new Date(b.release_date) - new Date(a.release_date));
  
  if (anyWithCert.length > 0) {
    return anyWithCert[0].certification;
  }
  
  // Step 3: No certification data found
  return null;
}

function getTmdbTvCertificationForCountry(certificationsData) {
  const countryData = certificationsData.results?.find(r => r.iso_3166_1 === 'US');
  if (!countryData?.rating) return null;
  
  return countryData.rating;
}


function parseAnimeRelationsLink(relationsData, type, userUUID) {
  if (!Array.isArray(relationsData) || relationsData.length === 0) {
    return [];
  }


  const relationLinks = relationsData.flatMap(relation => {
    const relationType = relation.relation;
    if (relationType !== 'Prequel' && relationType !== 'Sequel') {
      return [];
    }

    return (relation.entry || []).map(entry => {
      if (!entry.mal_id || !entry.name) return null;

      // Construct meta URL with proper UUID route if available
      const metaUrl = `stremio:///detail/${type}/mal:${entry.mal_id}`;

      return {
        name: entry.name,
        category: relationType,
        url: metaUrl
      };
    }).filter(Boolean);
  });

  return relationLinks;
}


async function getAnimeGenres() {
  const url = `${JIKAN_API_BASE}/genres/anime`;
  return enqueueRequest(() => _makeJikanRequest(url), url)
    .then(response => response.data?.data || [])
    .catch(e => {
      console.error(`Could not fetch anime genres from Jikan`, e.message);
      return [];
    });
}



function parseRunTime(runtime) {
  if (!runtime) return "";

  let totalMinutes;

  if (typeof runtime === 'number') {
    totalMinutes = runtime;
  }
  else if (typeof runtime === 'string') {
    let hours = 0;
    let minutes = 0;

    const hourMatch = runtime.match(/(\d+)\s*hr?/);
    if (hourMatch) {
      hours = parseInt(hourMatch[1], 10);
    }

    const minuteMatch = runtime.match(/(\d+)\s*min?/);
    if (minuteMatch) {
      minutes = parseInt(minuteMatch[1], 10);
    }
    if (hours === 0 && minutes === 0) {
      totalMinutes = parseInt(runtime, 10);
    } else {
      totalMinutes = (hours * 60) + minutes;
    }

  } else {
    return "";
  }

  if (isNaN(totalMinutes) || totalMinutes <= 0) {
    return "";
  }

  const finalHours = Math.floor(totalMinutes / 60);
  const finalMinutes = totalMinutes % 60;

  if (finalHours > 0) {
    const hourString = `${finalHours}h`;
    const minuteString = finalMinutes > 0 ? `${finalMinutes}min` : '';
    return `${hourString}${minuteString}`;
  } else {
    return `${finalMinutes}min`;
  }
}

function parseCreatedBy(created_by) {
  return created_by?.map((el) => el.name).join(', ') || '';
}

function parseConfig(catalogChoices) {
  if (!catalogChoices) return {};
  try {
    const config = JSON.parse(decompressFromEncodedURIComponent(catalogChoices));
    
    // Debug: Log art provider configuration
    if (config.artProviders) {
      console.log(`[Config Debug] Art providers:`, config.artProviders);
    }
    
    return config;
  } catch (e) {
    try { 
      const config = JSON.parse(catalogChoices);
      
      // Debug: Log art provider configuration
      if (config.artProviders) {
        console.log(`[Config Debug] Art providers:`, config.artProviders);
      }
      
      return config; 
    } catch { return {}; }
  }
}

function getRpdbPoster(type, ids, language, rpdbkey) {
    const tier = rpdbkey.split("-")[0]
    const lang = language.split("-")[0]
    const { tmdbId, tvdbId } = ids;
    let baseUrl = `https://api.ratingposterdb.com`;
    let idType = null;
    let fullMediaId = null;
    if (type === 'movie') {
        if (tvdbId) {
            idType = 'tvdb';
            fullMediaId = tvdbId;
        } else if (tmdbId) {
            idType = 'tmdb';
            fullMediaId = `movie-${tmdbId}`;
        } else if (ids.imdbId) {
            idType = 'imdb';
            fullMediaId = ids.imdbId;
        }
    } else if (type === 'series') {
        if (tvdbId) {
            idType = 'tvdb';
            fullMediaId = tvdbId;
        } else if (tmdbId) {
            idType = 'tmdb';
            fullMediaId = `series-${tmdbId}`;
        } else if (ids.imdbId) {
            idType = 'imdb';
            fullMediaId = ids.imdbId;
        }
    }
    if (!idType || !fullMediaId) {
        return null;
    }

    const urlPath = `${baseUrl}/${rpdbkey}/${idType}/poster-default/${fullMediaId}.jpg`;
    //console.log(urlPath);
    if (tier === "t0" || tier === "t1" || lang === "en") {
        return `${urlPath}?fallback=true`;
    } else {
        return `${urlPath}?fallback=true&lang=${lang}`;
    }
}

async function checkIfExists(url) {
  try {
    const response = await axios.head(url, {
      maxRedirects: 0,
      validateStatus: () => true,
      headers: { 'User-Agent': 'AIOMetadataAddon/1.0' }
    });
    return response.status === 200;
  } catch (error) {
    if (error.message.includes('Invalid URL')) {
      return false;
    }
    console.error(`Network error in checkIfExists for URL ${url}:`, error.message);
    return false;
  }
}

async function parsePoster(type, ids, fallbackFullUrl, language, rpdbkey) {
  if (rpdbkey) {
    const rpdbImage = getRpdbPoster(type, ids, language, rpdbkey);
    if (rpdbImage && await checkIfExists(rpdbImage)) {
      return rpdbImage;
    }
  }
  return fallbackFullUrl;
}

// Helper to resolve art provider for specific art type, using meta provider if artProvider is 'meta'
function resolveArtProvider(contentType, artType, config) {
  const artProviderConfig = config.artProviders?.[contentType];
  
  // Handle legacy string format
  if (typeof artProviderConfig === 'string') {
    if (artProviderConfig === 'meta' || !artProviderConfig) {
      return config.providers?.[contentType] || getDefaultProvider(contentType);
    }
    return artProviderConfig;
  }
  
  // Handle new nested object format
  if (typeof artProviderConfig === 'object' && artProviderConfig !== null) {
    const provider = artProviderConfig[artType];
    if (provider === 'meta' || !provider) {
      return config.providers?.[contentType] || getDefaultProvider(contentType);
    }
    return provider;
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

async function getAnimeBg({ tvdbId, tmdbId, malId, malPosterUrl, mediaType = 'series' }, config) {
  
  console.log(`[getAnimeBg] Fetching background for ${mediaType} with TVDB ID: ${tvdbId}, TMDB ID: ${tmdbId}, MAL ID: ${malId}`);
  
  // Check art provider preference
  const artProvider = resolveArtProvider('anime', 'background', config);
  
  if (artProvider === 'anilist' && malId) {
    try {
      const anilistData = await anilist.getAnimeArtwork(malId);
      console.log(`[getAnimeBg] AniList data for MAL ID ${malId}:`, {
        hasData: !!anilistData,
        hasBannerImage: !!anilistData?.bannerImage,
        bannerImage: anilistData?.bannerImage?.substring(0, 50) + '...'
      });
      
      if (anilistData) {
        const anilistBackground = anilist.getBackgroundUrl(anilistData);
        console.log(`[getAnimeBg] AniList background URL for MAL ID ${malId}:`, anilistBackground?.substring(0, 50) + '...');
        
        if (anilistBackground) {
          console.log(`[getAnimeBg] Found AniList background for MAL ID: ${malId}`);
          return anilistBackground;
        } else {
          console.log(`[getAnimeBg] No AniList background URL found for MAL ID: ${malId}`);
        }
      }
    } catch (error) {
      console.warn(`[getAnimeBg] AniList background fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  
  if (artProvider === 'tvdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.thetvdb_id) {
        // Use the appropriate TVDB function based on media type
        const tvdbBackground = mediaType === 'movie'
          ? await tvdb.getMovieBackground(mapping.thetvdb_id, config)
          : await tvdb.getSeriesBackground(mapping.thetvdb_id, config);
        
        if (tvdbBackground) {
          console.log(`[getAnimeBg] Found TVDB background for MAL ID: ${malId} (TVDB ID: ${mapping.thetvdb_id}, Type: ${mediaType})`);
          return tvdbBackground;
        }
      }
    } catch (error) {
      console.warn(`[getAnimeBg] TVDB background fetch failed for MAL ID ${malId}:`, error.message);
    }
  }

  if (artProvider === 'imdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.imdb_id) {
        return imdb.getBackgroundFromImdb(mapping.imdb_id);
      }
    } catch (error) {
      console.warn(`[getAnimeBg] IMDB background fetch failed for MAL ID ${malId}:`, error.message);
    }
  }

  if (artProvider === 'tmdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.themoviedb_id) {
        // Use TMDB background for anime
        const tmdbBackground = mediaType === 'movie' 
          ? await tmdb.movieImages({ id: tmdbId, include_image_language: null }, config).then(res => {
            const img = res.backdrops[0];
            return `https://image.tmdb.org/t/p/original${img?.file_path}`;
          })
          : await tmdb.tvImages({ id: tmdbId, include_image_language: null }, config).then(res => {
            const img = res.backdrops[0];
            return `https://image.tmdb.org/t/p/original${img?.file_path}`;
          });
        
        if (tmdbBackground) {
          console.log(`[getAnimeBg] Found TMDB background for MAL ID: ${malId} (TMDB ID: ${mapping.themoviedb_id}, Type: ${mediaType})`);
          return tmdbBackground;
        }
      }
    } catch (error) {
      console.warn(`[getAnimeBg] TMDB background fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  
  if (config.apiKeys.fanart) {
    console.log(`[getAnimeBg] Fetching background from Fanart.tv for ${mediaType}`);
    let fanartUrl = null;
    if (mediaType === 'series') {
      if (tvdbId) {
        console.log(`[getAnimeBg] Found TVDB ID for MAL ID: ${malId} (TVDB ID: ${tvdbId})`);
        fanartUrl = await fanart.getBestSeriesBackground(tvdbId, config);
      } else {
        console.log(`[getAnimeBg] No TVDB ID found for MAL ID: ${malId}`);
        const mapping = idMapper.getMappingByMalId(malId);
        console.log(`[getAnimeBg] Mapping for MAL ID: ${malId}:`, mapping);
        if (mapping && mapping.thetvdb_id) {
          console.log(`[getAnimeBg] Found TVDB ID for MAL ID: ${malId} (TVDB ID: ${mapping.thetvdb_id})`);
          fanartUrl = await fanart.getBestSeriesBackground(mapping.thetvdb_id, config);
        }
      }
    } else if (mediaType === 'movie') {
      if (tmdbId) {
        fanartUrl = await fanart.getBestMovieBackground(tmdbId, config);
      } else {
        const mapping = idMapper.getMappingByMalId(malId);
        if (mapping && mapping.themoviedb_id) {
          fanartUrl = await fanart.getBestMovieBackground(mapping.themoviedb_id, config);
        }
      }
    }

    if (fanartUrl) {
      console.log(`[getAnimeBg] Found high-quality Fanart.tv background.`);
      return fanartUrl;
    }
  }

  console.log(`[getAnimeBg] No Fanart or TMDB background found. Falling back to MAL poster.`);
  return malPosterUrl;
}


/**
 * Get anime logo with art provider preference
 */
async function getAnimeLogo({ malId, mediaType = 'series' }, config) {
  const artProvider = resolveArtProvider('anime', 'logo', config);
  const mapping = idMapper.getMappingByMalId(malId);
  const tvdbId = mapping?.thetvdb_id;
  const tmdbId = mapping?.themoviedb_id;
  
  if (artProvider === 'tvdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.thetvdb_id) {
        // Use the appropriate TVDB function based on media type
        const tvdbLogo = mediaType === 'movie'
          ? await tvdb.getMovieLogo(mapping.thetvdb_id, config)
          : await tvdb.getSeriesLogo(mapping.thetvdb_id, config);
        
        if (tvdbLogo) {
          //console.log(`[getAnimeLogo] Found TVDB logo for MAL ID: ${malId} (TVDB ID: ${mapping.thetvdb_id}, Type: ${mediaType})`);
          return tvdbLogo;
        }
      }
    } catch (error) {
      console.warn(`[getAnimeLogo] TVDB logo fetch failed for MAL ID ${malId}:`, error.message);
    }
  }

  if (artProvider === 'imdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.imdb_id) {
        return imdb.getLogoFromImdb(mapping.imdb_id);
      }
    } catch (error) {
      console.warn(`[getAnimeLogo] IMDB logo fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  if (artProvider === 'tmdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.themoviedb_id) {
        // Use TMDB logo for anime
        const tmdbLogo = mediaType === 'movie' 
          ? await tmdb.getTmdbMovieLogo(mapping.themoviedb_id, config)
          : await tmdb.getTmdbSeriesLogo(mapping.themoviedb_id, config);
        
        if (tmdbLogo) {
          //console.log(`[getAnimeLogo] Found TMDB logo for MAL ID: ${malId} (TMDB ID: ${mapping.themoviedb_id}, Type: ${mediaType})`);
          return tmdbLogo;
        }
      }
    } catch (error) {
      console.warn(`[getAnimeLogo] TMDB logo fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  // fallback to fanart
  if (config.apiKeys.fanart) {
    let fanartUrl = null;
    if (mediaType === 'series' && tvdbId) {
      const images = await fanart.getShowImages(tvdbId, config);
      const logo = selectFanartImageByLang(images?.hdtvlogo, config);
      fanartUrl = logo?.url;
    } else if (mediaType === 'movie' && tmdbId) {
      const images = await fanart.getMovieImages(tmdbId, config);
      const logo = selectFanartImageByLang(images?.hdmovielogo, config);
      fanartUrl = logo?.url;
    }
    if (fanartUrl) {
      console.log(`[getAnimeLogo] Found high-quality back up logo from Fanart.tv.`);
      return fanartUrl;
    }
  }
  return null;
}

/**
 * Get anime poster with art provider preference
 */
async function getAnimePoster({ malId, malPosterUrl, mediaType = 'series' }, config) {
  const artProvider = resolveArtProvider('anime', 'poster', config);
  const mapping = idMapper.getMappingByMalId(malId);
  const tvdbId = mapping?.thetvdb_id;
  const tmdbId = mapping?.themoviedb_id;
  if (artProvider === 'anilist' && malId) {
    try {
      const anilistData = await anilist.getAnimeArtwork(malId);
      if (anilistData) {
        const anilistPoster = anilist.getPosterUrl(anilistData);
        if (anilistPoster) {
          //console.log(`[getAnimePoster] Found AniList poster for MAL ID: ${malId}`);
          return anilistPoster;
        }
      }
    } catch (error) {
      console.warn(`[getAnimePoster] AniList poster fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  
  if (artProvider === 'tvdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.thetvdb_id) {
        // Use the appropriate TVDB function based on media type
        const tvdbPoster = mediaType === 'movie' 
          ? await tvdb.getMoviePoster(mapping.thetvdb_id, config)
          : await tvdb.getSeriesPoster(mapping.thetvdb_id, config);
        
        if (tvdbPoster) {
          //console.log(`[getAnimePoster] Found TVDB poster for MAL ID: ${malId} (TVDB ID: ${mapping.thetvdb_id}, Type: ${mediaType})`);
          return tvdbPoster;
        }
      }
    } catch (error) {
      console.warn(`[getAnimePoster] TVDB poster fetch failed for MAL ID ${malId}:`, error.message);
    }
  }

  if (artProvider === 'imdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.imdb_id) {
        return imdb.getPosterFromImdb(mapping.imdb_id);
      }
    } catch (error) {
      console.warn(`[getAnimePoster] IMDB poster fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  if (artProvider === 'tmdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.themoviedb_id) {
        // Use TMDB poster for anime
        const tmdbPoster = mediaType === 'movie' 
          ? await tmdb.getTmdbMoviePoster(mapping.themoviedb_id, config)
          : await tmdb.getTmdbSeriesPoster(mapping.themoviedb_id, config);
        
        if (tmdbPoster) {
          //console.log(`[getAnimePoster] Found TMDB poster for MAL ID: ${malId} (TMDB ID: ${mapping.themoviedb_id}, Type: ${mediaType})`);
          return tmdbPoster;
        }
      }
    } catch (error) {
      console.warn(`[getAnimePoster] TMDB poster fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  if (config.apiKeys.fanart) {
    let fanartUrl = null;
    console.log(`[getAnimePoster] Fetching background for ${mediaType} with TVDB ID: ${tvdbId}, TMDB ID: ${tmdbId}`);
    if (mediaType === 'series' && tvdbId) {
      const images = await fanart.getShowImages(tvdbId, config);
      const poster = selectFanartImageByLang(images?.tvposter, config);
      fanartUrl = poster?.url;
    } else if (mediaType === 'movie' && tmdbId) {
      const images = await fanart.getMovieImages(tmdbId, config);
      const poster = selectFanartImageByLang(images?.movieposter, config);
      fanartUrl = poster?.url;
    }

    if (fanartUrl) {
      //console.log(`[getAnimePoster] Found high-quality back up poster from Fanart.tv.`);
      return fanartUrl;
    }
  }
  
  return malPosterUrl;
}

/**
 * Get batch anime artwork for catalog usage
 */
async function getBatchAnimeArtwork(malIds, config) {
  const artProvider = resolveArtProvider('anime', 'poster', config);
  
  if (artProvider === 'anilist' && malIds && malIds.length > 0) {
    try {
      const artworkData = await anilist.getCatalogArtwork(malIds);
      console.log(`[getBatchAnimeArtwork] Retrieved ${artworkData.length} AniList artworks for ${malIds.length} MAL IDs`);
      return artworkData;
    } catch (error) {
      console.warn(`[getBatchAnimeArtwork] AniList batch fetch failed:`, error.message);
    }
  }
  
  return [];
}

async function parseAnimeCatalogMeta(anime, config, language, descriptionFallback = null) {
  if (!anime || !anime.mal_id) return null;

  const malId = anime.mal_id;
  const stremioType = anime.type?.toLowerCase() === 'movie' ? 'movie' : 'series';
  const preferredProvider = config.providers?.anime || 'mal';

  const mapping = idMapper.getMappingByMalId(malId);
  let id = `mal:${malId}`;
  if (preferredProvider === 'tvdb') {
    if (mapping && mapping.thetvdb_id) {
      id= `tvdb:${mapping.thetvdb_id}`;
    }
  } else if (preferredProvider === 'tmdb') {
    if (mapping && mapping.themoviedb_id) {
      id = `tmdb:${mapping.themoviedb_id}`;
    }
  } else if (preferredProvider === 'imdb') {
    if (mapping && mapping.imdb_id) {
      id= `${mapping.imdb_id}`;
    }
  } 
  
  const malPosterUrl = anime.images?.jpg?.large_image_url;
  let finalPosterUrl = malPosterUrl || `https://artworks.thetvdb.com/banners/images/missing/series.jpg`;
  
  // Check art provider preference
  const artProvider = resolveArtProvider('anime', 'poster', config);
  if (artProvider === 'anilist' && malId) {
    try {
      const anilistData = await anilist.getAnimeArtwork(malId);
      if (anilistData) {
        const anilistPoster = anilist.getPosterUrl(anilistData);
        if (anilistPoster) {
          console.log(`[parseAnimeCatalogMeta] Using AniList poster for MAL ID: ${malId}`);
          finalPosterUrl = anilistPoster;
        }
      }
    } catch (error) {
      console.warn(`[parseAnimeCatalogMeta] AniList poster fetch failed for MAL ID ${malId}:`, error.message);
    }
  } else if (artProvider === 'tvdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.thetvdb_id) {
        // Use the appropriate TVDB function based on media type
        const tvdbPoster = stremioType === 'movie'
          ? await tvdb.getMoviePoster(mapping.thetvdb_id, config)
          : await tvdb.getSeriesPoster(mapping.thetvdb_id, config);
        
        if (tvdbPoster) {
          console.log(`[parseAnimeCatalogMeta] Using TVDB poster for MAL ID: ${malId} (TVDB ID: ${mapping.thetvdb_id}, Type: ${stremioType})`);
          finalPosterUrl = tvdbPoster;
        }
      }
    } catch (error) {
      console.warn(`[parseAnimeCatalogMeta] TVDB poster fetch failed for MAL ID ${malId}:`, error.message);
    }
  } else if (artProvider === 'tmdb' && malId) {
    try {
      const mapping = idMapper.getMappingByMalId(malId);
      if (mapping && mapping.themoviedb_id) {
        // Use TMDB poster for anime
        const tmdbPoster = stremioType === 'movie' 
          ? await tmdb.getTmdbMoviePoster(mapping.themoviedb_id, config)
          : await tmdb.getTmdbSeriesPoster(mapping.themoviedb_id, config);
        
        if (tmdbPoster) {
          console.log(`[parseAnimeCatalogMeta] Using TMDB poster for MAL ID: ${malId} (TMDB ID: ${mapping.themoviedb_id}, Type: ${stremioType})`);
          finalPosterUrl = tmdbPoster;
        }
      }
    } catch (error) {
      console.warn(`[parseAnimeCatalogMeta] TMDB poster fetch failed for MAL ID ${malId}:`, error.message);
    }
  }
  
  //const kitsuId = mapping?.kitsu_id;
  const imdbId = mapping?.imdb_id;
  const tmdbId = mapping?.themoviedb_id;
  const imdbRating = await getImdbRating(imdbId, stremioType);
  //const metaType = (kitsuId || imdbId) ? stremioType : 'anime';
  if (config.apiKeys?.rpdb) {

    if (mapping) {
      const tvdbId = mapping.thetvdb_id;
      const tmdbId = mapping.themoviedb_id;
      let proxyId = null;

      if (stremioType === 'series') {
        proxyId = tvdbId ? `tvdb:${tvdbId}` : (tmdbId ? `tmdb:${tmdbId}` : null);
      } else if (stremioType === 'movie') {
        proxyId = tmdbId ? `tmdb:${tmdbId}` : null;
      }

      if (proxyId) {
        const fallback = encodeURIComponent(finalPosterUrl);
        finalPosterUrl = `${host}/poster/${stremioType}/${proxyId}?fallback=${fallback}&lang=${language}&key=${config.apiKeys?.rpdb}`;
      }
    }
  }
  const trailerStreams = [];
  if (anime.trailer?.youtube_id) {
    trailerStreams.push({
      ytId: anime.trailer.youtube_id,
      title: anime.title_english || anime.title
    });
  }
  const trailers = [];
  if (anime.trailer?.youtube_id) {
    trailers.push({
      source: anime.trailer.youtube_id,
      type: "Trailer",
      name: anime.title_english || anime.title
    });
  }
  return {
    id:  `mal:${malId}`,
    type: stremioType,
    logo: stremioType === 'movie' ? await tmdb.getTmdbMovieLogo(tmdbId, config) : await tmdb.getTmdbSeriesLogo(tmdbId, config),
    name: anime.title_english || anime.title,
    poster: finalPosterUrl,
    description: descriptionFallback || anime.synopsis,
    year: anime.year,
    imdb_id: mapping?.imdb_id,
    releaseInfo: anime.year,
    imdbRating: imdbRating,
    runtime: parseRunTime(anime.duration),
    isAnime: true,
    trailers: trailers,
    trailerStreams: trailerStreams
  };
}

/**
 * Batch version of parseAnimeCatalogMeta that uses AniList batch fetching for better performance
 */
async function parseAnimeCatalogMetaBatch(animes, config, language) {
  if (!animes || animes.length === 0) return [];

  const artProvider = resolveArtProvider('anime', 'poster', config);
  const useAniList = artProvider === 'anilist';
  const useTvdb = artProvider === 'tvdb';
  const useImdb = artProvider === 'imdb';
  const useTmdb = artProvider === 'tmdb';
  //console.log(`[parseAnimeCatalogMetaBatch] Art provider: ${artProvider}, useAniList: ${useAniList}, useTvdb: ${useTvdb}, useTmdb: ${useTmdb}`);
  
  // Extract MAL IDs and try to get AniList IDs from mappings
  const malIds = animes.map(anime => anime.mal_id).filter(id => id && typeof id === 'number' && id > 0);
  let anilistArtworkMap = new Map();
  
  if (useAniList && malIds.length > 0) {
    try {
      //console.log(`[parseAnimeCatalogMetaBatch] Fetching AniList artwork for ${malIds.length} anime in batch`);
      //console.log(`[parseAnimeCatalogMetaBatch] MAL IDs: ${malIds.slice(0, 10).join(', ')}${malIds.length > 10 ? '...' : ''}`);
      
      // First, try to get AniList IDs from mappings
      const malToAnilistMap = new Map();
      const anilistIds = [];
      const malIdsWithoutAnilist = [];
      
      malIds.forEach(malId => {
        const mapping = idMapper.getMappingByMalId(malId);
        if (mapping && mapping.anilist_id) {
          malToAnilistMap.set(mapping.anilist_id, malId);
          anilistIds.push(mapping.anilist_id);
        } else {
          malIdsWithoutAnilist.push(malId);
        }
      });
      
      //console.log(`[parseAnimeCatalogMetaBatch] Found ${anilistIds.length} AniList IDs, ${malIdsWithoutAnilist.length} MAL IDs without AniList mapping`);
      
      let anilistArtwork = [];
      
      // Batch fetch using AniList IDs if we have them
      if (anilistIds.length > 0) {
        //console.log(`[parseAnimeCatalogMetaBatch] Fetching via AniList IDs: ${anilistIds.slice(0, 10).join(', ')}${anilistIds.length > 10 ? '...' : ''}`);
        const anilistResults = await anilist.getBatchAnimeArtworkByAnilistIds(anilistIds);
        anilistArtwork.push(...anilistResults);
      }
      
      // Fallback to MAL IDs for those without AniList mappings
      if (malIdsWithoutAnilist.length > 0) {
        //console.log(`[parseAnimeCatalogMetaBatch] Fallback to MAL IDs: ${malIdsWithoutAnilist.slice(0, 10).join(', ')}${malIdsWithoutAnilist.length > 10 ? '...' : ''}`);
        const malResults = await anilist.getBatchAnimeArtwork(malIdsWithoutAnilist, config);
        anilistArtwork.push(...malResults);
      }
      
      // Create a map for quick lookup - use idMal since that's what both methods return
      anilistArtworkMap = new Map(
        anilistArtwork.map(artwork => [artwork.idMal, artwork])
      );
      //console.log(`[parseAnimeCatalogMetaBatch] Successfully fetched ${anilistArtwork.length} AniList artworks`);
      //console.log(`[parseAnimeCatalogMetaBatch] AniList map keys: ${Array.from(anilistArtworkMap.keys()).slice(0, 5).join(', ')}...`);
      /*console.log(`[parseAnimeCatalogMetaBatch] Sample AniList data:`, anilistArtwork[0] ? {
        malId: anilistArtwork[0].idMal,
        id: anilistArtwork[0].id,
        title: anilistArtwork[0].title?.english || anilistArtwork[0].title?.romaji
      } : 'No data');*/
    } catch (error) {
      console.warn(`[parseAnimeCatalogMetaBatch] AniList batch fetch failed:`, error.message);
    }
  }

  // Process each anime
  const results = await Promise.all(animes.map(async anime => {
    if (!anime || !anime.mal_id) return null;

    const malId = anime.mal_id;
    const stremioType = anime.type?.toLowerCase() === 'movie' ? 'movie' : 'series';
    const preferredProvider = config.providers?.anime || 'mal';

    const mapping = idMapper.getMappingByMalId(malId);
    let id = `mal:${malId}`;
    if (preferredProvider === 'tvdb') {
      if (mapping && mapping.thetvdb_id) {
        id= `tvdb:${mapping.thetvdb_id}`;
      }
    } else if (preferredProvider === 'tmdb') {
      if (mapping && mapping.themoviedb_id) {
        id = `tmdb:${mapping.themoviedb_id}`;
      }
    } else if (preferredProvider === 'imdb') {
      if (mapping && mapping.imdb_id) {
        id= `${mapping.imdb_id}`;
      }
    } 
    
    const malPosterUrl = anime.images?.jpg?.large_image_url;
    let finalPosterUrl = malPosterUrl || `https://artworks.thetvdb.com/banners/images/missing/series.jpg`;
    
    // Use batch-fetched AniList artwork if available
    if (useAniList && anilistArtworkMap.has(malId)) {
      const anilistData = anilistArtworkMap.get(malId);
      const anilistPoster = anilist.getPosterUrl(anilistData);
      if (anilistPoster) {
        //console.log(`[parseAnimeCatalogMetaBatch] Using AniList poster for MAL ID: ${malId}`);
        finalPosterUrl = anilistPoster;
      } else {
        //console.log(`[parseAnimeCatalogMetaBatch] AniList data found but no poster URL for MAL ID: ${malId}`);
      }
    } else if (useAniList) {
      //console.log(`[parseAnimeCatalogMetaBatch] No AniList data found for MAL ID: ${malId}`);
    }
    
    // Check for TVDB poster if configured as art provider
    if (useTvdb && mapping && mapping.thetvdb_id) {
      try {
        // Use the appropriate TVDB function based on media type
        const tvdbPoster = await tvdb.getSeriesPoster(mapping.thetvdb_id, config);
        
        if (tvdbPoster) {
          //console.log(`[parseAnimeCatalogMetaBatch] Using TVDB poster for MAL ID: ${malId} (TVDB ID: ${mapping.thetvdb_id}, Type: ${stremioType})`);
          finalPosterUrl = tvdbPoster;
        }
      } catch (error) {
        console.warn(`[parseAnimeCatalogMetaBatch] TVDB poster fetch failed for MAL ID ${malId}:`, error.message);
      }
    }
    
    // Check for TMDB poster if configured as art provider
    if (useTmdb && mapping && mapping.themoviedb_id) {
      try {
        // Use TMDB poster for anime
        const tmdbPoster = stremioType === 'movie' 
          ? await tmdb.getTmdbMoviePoster(mapping.themoviedb_id, config)
          : await tmdb.getTmdbSeriesPoster(mapping.themoviedb_id, config);
        
        if (tmdbPoster) {
          //console.log(`[parseAnimeCatalogMetaBatch] Using TMDB poster for MAL ID: ${malId} (TMDB ID: ${mapping.themoviedb_id}, Type: ${stremioType})`);
          finalPosterUrl = tmdbPoster;
        }
      } catch (error) {
        console.warn(`[parseAnimeCatalogMetaBatch] TMDB poster fetch failed for MAL ID ${malId}:`, error.message);
      }
    }

    if (useImdb && mapping && mapping.imdb_id) {
      try {
        finalPosterUrl = imdb.getPosterFromImdb(mapping.imdb_id);
      } catch (error) {
        console.warn(`[parseAnimeCatalogMetaBatch] IMDB poster fetch failed for MAL ID ${malId}:`, error.message);
      }
    }
    
    if (config.apiKeys?.rpdb) {
      if (mapping) {
        const tvdbId = mapping.thetvdb_id;
        const tmdbId = mapping.themoviedb_id;
        let proxyId = null;

        if (stremioType === 'series') {
          proxyId = tvdbId ? `tvdb:${tvdbId}` : (tmdbId ? `tmdb:${tmdbId}` : null);
        } else if (stremioType === 'movie') {
          proxyId = tmdbId ? `tmdb:${tmdbId}` : null;
        }

        if (proxyId) {
          const fallback = encodeURIComponent(finalPosterUrl);
          finalPosterUrl = `${host}/poster/${stremioType}/${proxyId}?fallback=${fallback}&lang=${language}&key=${config.apiKeys?.rpdb}`;
        }
      }
    }
    const imdbId = mapping?.imdb_id;
    const tmdbId = mapping?.themoviedb_id;
    const imdbRating = await getImdbRating(imdbId, stremioType);
    const trailerStreams = [];
    if (anime.trailer?.youtube_id) {
      trailerStreams.push({
        ytId: anime.trailer.youtube_id,
        title: anime.title_english || anime.title
      });
    }
    const trailers = [];
    if (anime.trailer?.youtube_id) {
      trailers.push({
        source: anime.trailer.youtube_id,
        type: "Trailer",
        name: anime.title_english || anime.title
      });
    }

    return {
      id:  `mal:${malId}`,
      type: stremioType,
      logo: stremioType === 'movie' ? await tmdb.getTmdbMovieLogo(tmdbId, config) : await tmdb.getTmdbSeriesLogo(tmdbId, config),
      name: anime.title_english || anime.title,
      poster: finalPosterUrl,
      description: addMetaProviderAttribution(anime.synopsis, 'MAL', config),
      year: anime.year,
      imdb_id: mapping?.imdb_id,
      releaseInfo: anime.year,
      runtime: parseRunTime(anime.duration),
      imdbRating: imdbRating,
      trailers: trailers,
      trailerStreams: trailerStreams
      };
  }));
  
  return results.filter(Boolean);
}

/**
 * Parses a YouTube URL and extracts the video ID (the 'v' parameter).
 * @param {string} url - The full YouTube URL.
 * @returns {string|null} The YouTube video ID, or null if not found.
 */
function getYouTubeIdFromUrl(url) {
  if (!url) return null;
  try {
    const urlObject = new URL(url);
    // Standard YouTube URLs have the ID in the 'v' query parameter.
    if (urlObject.hostname === 'www.youtube.com' || urlObject.hostname === 'youtube.com') {
      return urlObject.searchParams.get('v');
    }
    // Handle youtu.be short links
    if (urlObject.hostname === 'youtu.be') {
      return urlObject.pathname.slice(1); // Remove the leading '/'
    }
  } catch (error) {
    console.warn(`[Parser] Could not parse invalid URL for YouTube ID: ${url}`);
  }
  return null;
}

/**
 * Parses the trailers array from the TVDB API into Stremio-compatible formats.
 * @param {Array} tvdbTrailers - The `trailers` array from the TVDB API response.
 * @param {string} defaultTitle - A fallback title to use for the trailer.
 * @returns {{trailers: Array, trailerStreams: Array}} An object containing both formats.
 */
function parseTvdbTrailers(tvdbTrailers, defaultTitle = 'Official Trailer') {
  const trailers = [];
  const trailerStreams = [];

  if (!Array.isArray(tvdbTrailers)) {
    return { trailers, trailerStreams };
  }

  for (const trailer of tvdbTrailers) {
    if (trailer.url && trailer.url.includes('youtube.com') || trailer.url.includes('youtu.be')) {
      const ytId = getYouTubeIdFromUrl(trailer.url);

      if (ytId) {
        const title = trailer.name || defaultTitle;

        trailers.push({
          source: ytId,
          type: 'Trailer',
          name: defaultTitle
        });

        trailerStreams.push({
          ytId: ytId,
          title: title
        });
      }
    }
  }

  return { trailers, trailerStreams };
}

/**
 * Get movie poster with art provider preference
 */
async function getMoviePoster({ tmdbId, tvdbId, imdbId, metaProvider, fallbackPosterUrl }, config) {
  const artProvider = resolveArtProvider('movie', 'poster', config);
  
  if (artProvider === 'tvdb' && metaProvider != 'tvdb') {
    try {
      if(tvdbId) {
      const tvdbPoster = await tvdb.getMoviePoster(tvdbId, config);
      if (tvdbPoster) {
        console.log(`[getMoviePoster] Found TVDB poster for movie (TVDB ID: ${tvdbId})`);
          return tvdbPoster;
        }
      }
      else {
        if(!tmdbId) return fallbackPosterUrl;
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'movie', config);
        if(mappedIds.tvdbId) {
          const tvdbPoster = await tvdb.getMoviePoster(mappedIds.tvdbId, config);
          console.log(`[getMoviePoster] Found TVDB poster via ID mapping for movie (TMDB ID: ${tmdbId} → TVDB ID: ${mappedIds.tvdbId})`);
          return tvdbPoster;
        }
      }
    } catch (error) {
      console.warn(`[getMoviePoster] TVDB poster fetch failed for movie (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'fanart') {
    try {
      if(tmdbId) {
        const images = await fanart.getMovieImages(tmdbId, config);
        const poster = selectFanartImageByLang(images?.movieposter, config);
        if (poster) {
          console.log(`[getMoviePoster] Found Fanart.tv poster for movie (TMDB ID: ${tmdbId}, lang: ${poster.lang})`);
          return poster.url;
        }
      }
      else {
        if(!tvdbId) return fallbackPosterUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
        if(mappedIds.tmdbId) {
          const images = await fanart.getMovieImages(mappedIds.tmdbId, config);
          const poster = selectFanartImageByLang(images?.movieposter, config);
          if (poster) {
            console.log(`[getMoviePoster] Found Fanart.tv poster via ID mapping for movie (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId}, lang: ${poster.lang})`);
            return poster.url;
          }
        }
      }
    } catch (error) {
      console.warn(`[getMoviePoster] Fanart.tv poster fetch failed for movie (TMDB ID: ${tmdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'tmdb' && metaProvider != 'tmdb') {
    try {
      if(tmdbId) {
        const tmdbPoster = await tmdb.movieImages({ id: tmdbId }, config).then(res => {
          const img = selectTmdbImageByLang(res.posters, config);
          return img?.file_path;
        });
        console.log(`[getMoviePoster] Found TMDB poster for movie (TMDB ID: ${tmdbId})`);
        return `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tmdbPoster}`;
      }
      else {
        if(!tvdbId) return fallbackPosterUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
        if(mappedIds.tmdbId) {
          const tmdbPoster = await tmdb.movieImages({ id: mappedIds.tmdbId }, config).then(res => {
            const img = selectTmdbImageByLang(res.posters, config);
            return img?.file_path;
          });
          console.log(`[getMoviePoster] Found TMDB poster via ID mapping for movie (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId})`);
          return `https://image.tmdb.org/t/p/w500${tmdbPoster}`;
        }
      }
    } catch (error) {
      console.warn(`[getMoviePoster] TMDB ID mapping failed for movie (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  else if (artProvider === 'imdb' && metaProvider != 'imdb') {
    if(imdbId) {
      return imdb.getPosterFromImdb(imdbId);
    } else if(tvdbId) {
      const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
      if (mappedIds.imdbId) {
        return imdb.getPosterFromImdb(mappedIds.imdbId);
      }
    }
  }

  return fallbackPosterUrl;
}

/**
 * Get movie background with art provider preference
 */
async function getMovieBackground({ tmdbId, tvdbId, imdbId, metaProvider, fallbackBackgroundUrl }, config) {
  const artProvider = resolveArtProvider('movie', 'background', config);
  
  if (artProvider === 'tvdb' && metaProvider != 'tvdb') {
    try {
      if(tvdbId) {
        console.log(`[getMovieBackground] Fetching TVDB background for movie (TVDB ID: ${tvdbId})`);
        const tvdbBackground = await tvdb.getMovieBackground(tvdbId, config);
        if (tvdbBackground) {
          console.log(`[getMovieBackground] Found TVDB background for movie (TVDB ID: ${tvdbId}): ${tvdbBackground.substring(0, 50)}...`);
          return tvdbBackground;
        }
      }
      else {
        if(!tmdbId) return fallbackBackgroundUrl;
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'movie', config);
        if(mappedIds.tvdbId) {
          const tvdbBackground = await tvdb.getMovieBackground(mappedIds.tvdbId, config);
          console.log(`[getMovieBackground] Found TVDB background via ID mapping for movie (TMDB ID: ${tmdbId} → TVDB ID: ${mappedIds.tvdbId})`);
          return tvdbBackground;
        }
      }
    } catch (error) {
      console.warn(`[getMovieBackground] TVDB background fetch failed for movie (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'fanart') {
    try {
      if(tmdbId) {
        const images = await fanart.getMovieImages(tmdbId, config);
        const bg = selectFanartImageByLang(images?.moviebackground, config);
        if (bg) {
          console.log(`[getMovieBackground] Found Fanart.tv background for movie (TMDB ID: ${tmdbId}, lang: ${bg.lang})`);
          return bg.url;
        }
      }
      else {
        if(!tvdbId) return fallbackBackgroundUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
        if(mappedIds.tmdbId) {
          const images = await fanart.getMovieImages(mappedIds.tmdbId, config);
          const bg = selectFanartImageByLang(images?.moviebackground, config);
          if (bg) {
            console.log(`[getMovieBackground] Found Fanart.tv background via ID mapping for movie (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId}, lang: ${bg.lang})`);
            return bg.url;
          }
        }
      }
    } catch (error) {
      console.warn(`[getMovieBackground] Fanart.tv background fetch failed for movie (TMDB ID: ${tmdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'tmdb' && metaProvider != 'tmdb') {
    try {
      if(tmdbId) {
        const tmdbBackground = await tmdb.movieImages({ id: tmdbId, include_image_language: null }, config).then(res => {
          const img = res.backdrops[0];
          return img?.file_path;
        });
        console.log(`[getMovieBackground] Found TMDB background for movie (TMDB ID: ${tmdbId})`);
        return `https://image.tmdb.org/t/p/original${tmdbBackground}`;
      }
      else {
        if(!tvdbId) return fallbackBackgroundUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
        if(mappedIds.tmdbId) {
          const tmdbBackground = await tmdb.movieImages({ id: mappedIds.tmdbId, include_image_language: null }, config).then(res => {
            const img = res.backdrops[0];
            return img?.file_path;
          });
          console.log(`[getMovieBackground] Found TMDB background via ID mapping for movie (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId})`);
          return `https://image.tmdb.org/t/p/original${tmdbBackground}`;
        }
      }
    } catch (error) {
      console.warn(`[getMovieBackground] TMDB ID mapping failed for movie (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  else if (artProvider === 'imdb' && metaProvider != 'imdb') {
    if(imdbId) {
      return imdb.getBackgroundFromImdb(imdbId);
    }
  }
  return fallbackBackgroundUrl;
}

/**
 * Get movie logo with art provider preference
 */
async function getMovieLogo({ tmdbId, tvdbId, imdbId, metaProvider, fallbackLogoUrl }, config) {
  const artProvider = resolveArtProvider('movie', 'logo', config);
  
  if (artProvider === 'tvdb' && metaProvider != 'tvdb') {
    try {
      if(tvdbId) {
        const tvdbLogo = await tvdb.getMovieLogo(tvdbId, config);
        if (tvdbLogo) {
          console.log(`[getMovieLogo] Found TVDB logo for movie (TVDB ID: ${tvdbId})`);
          return tvdbLogo;
        }
      }
      else {
        if(!tmdbId) return fallbackLogoUrl;
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'movie', config);
        if(mappedIds.tvdbId) {
          const tvdbLogo = await tvdb.getMovieLogo(mappedIds.tvdbId, config);
          console.log(`[getMovieLogo] Found TVDB logo via ID mapping for movie (TMDB ID: ${tmdbId} → TVDB ID: ${mappedIds.tvdbId})`);
          return tvdbLogo;
        }
      }
    } catch (error) {
      console.warn(`[getMovieLogo] TVDB logo fetch failed for movie (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'fanart') {
    try {
      if(tmdbId) {
        const images = await fanart.getMovieImages(tmdbId, config);
        const logo = selectFanartImageByLang(images?.hdmovielogo, config);
        if (logo) {
          console.log(`[getMovieLogo] Found Fanart.tv logo for movie (TMDB ID: ${tmdbId}, lang: ${logo.lang})`);
          return logo.url;
        }
      }
      else {
        if(!tvdbId) return fallbackLogoUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
        if(mappedIds.tmdbId) {
          const images = await fanart.getMovieImages(mappedIds.tmdbId, config);
          const logo = selectFanartImageByLang(images?.hdmovielogo, config);
          if (logo) {
            console.log(`[getMovieLogo] Found Fanart.tv logo via ID mapping for movie (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId}, lang: ${logo.lang})`);
            return logo.url;
          }
        }
      }
    } catch (error) {
      console.warn(`[getMovieLogo] Fanart.tv logo fetch failed for movie (TMDB ID: ${tmdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'tmdb') {
    try {
      if(tmdbId) {
        const tmdbLogo = await tmdb.movieImages({ id: tmdbId }, config).then(res => {
          const img = selectTmdbImageByLang(res.logos, config);
          return img?.file_path;
        });
        if (tmdbLogo) {
          console.log(`[getMovieLogo] Found TMDB logo for movie (TMDB ID: ${tmdbId})`);
          return `https://image.tmdb.org/t/p/original${tmdbLogo}`;
        }
      }
      else {
        if(!tvdbId) return fallbackLogoUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
        if(mappedIds.tmdbId) {
          const tmdbLogo = await tmdb.movieImages({ id: mappedIds.tmdbId }, config).then(res => {
            const img = selectTmdbImageByLang(res.logos, config);
            return img?.file_path;
          });
          if (tmdbLogo) {
            console.log(`[getMovieLogo] Found TMDB logo via ID mapping for movie (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId})`);
            return `https://image.tmdb.org/t/p/original${tmdbLogo}`;
          }
        }
      }
    } catch (error) {
      console.warn(`[getMovieLogo] TMDB logo fetch failed for movie (TMDB ID: ${tmdbId}):`, error.message);
    }
  }
  else if (artProvider === 'imdb' && metaProvider != 'imdb') {
    if(imdbId) {
      return imdb.getLogoFromImdb(imdbId);
    } else if(tvdbId) {
      const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'movie', config);
      if(mappedIds.imdbId) {
        return imdb.getLogoFromImdb(mappedIds.imdbId);
      }
    }
  }
  
  return fallbackLogoUrl;
}

/**
 * Get series poster with art provider preference
 */
async function getSeriesPoster({ tmdbId, tvdbId, imdbId, metaProvider, fallbackPosterUrl }, config) {
  const artProvider = resolveArtProvider('series', 'poster', config);
  
  if (artProvider === 'tvdb') {
    try {
      if(tvdbId) {
        const tvdbPoster = await tvdb.getSeriesPoster(tvdbId, config);
        if (tvdbPoster) {
        return tvdbPoster;
      }
      else {
        if(!tmdbId) return fallbackPosterUrl;
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'series', config, null, ['tvdb']);
        if(mappedIds.tvdbId) {
          const tvdbPoster = await tvdb.getSeriesPoster(mappedIds.tvdbId, config);
          return tvdbPoster;
        }
      }
    }
    } catch (error) {
      console.warn(`[getSeriesPoster] TVDB poster fetch failed for series (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'fanart') {
    try {
      if(tvdbId) {
        const images = await fanart.getShowImages(tvdbId, config);
        const poster = selectFanartImageByLang(images?.tvposter, config);
        if (poster) {
          return poster.url;
        }
      }
      else if(tmdbId) {
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'series', config, null, ['tvdb']);
        if(mappedIds.tvdbId) {
          const images = await fanart.getShowImages(mappedIds.tvdbId, config);
          const poster = selectFanartImageByLang(images?.tvposter, config);
          if (poster) {
              return poster.url;
          }
        }
      }
      
    } catch (error) {
      console.warn(`[getSeriesPoster] Fanart.tv poster fetch failed for series (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'tmdb' && metaProvider != 'tmdb') {
    try {
      if(tmdbId) {
        const tmdbPoster = await tmdb.tvImages({ id: tmdbId }, config).then(res => {
          const img = selectTmdbImageByLang(res.posters, config);
          return img?.file_path;
        });
        if (tmdbPoster) {
          return `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tmdbPoster}`;
        }
      }
      else {
        if(!tvdbId) return fallbackPosterUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'series', config, null, ['tmdb']);
        if(mappedIds.tmdbId) {
          const tmdbPoster = await tmdb.tvImages({ id: mappedIds.tmdbId }, config).then(res => {
            const img = selectTmdbImageByLang(res.posters, config);
            return img?.file_path;
          });
          if (tmdbPoster) {
            return `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tmdbPoster}`;
          }
        }
      }
    } catch (error) {
      console.warn(`[getSeriesPoster] TMDB ID mapping failed for series (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  else if (artProvider === 'imdb' && metaProvider != 'imdb') {
    if(imdbId) {
      return imdb.getPosterFromImdb(imdbId);
    } else if(tvdbId) {
      const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'series', config, null, ['imdb']);
      if(mappedIds.imdbId) {
        return imdb.getPosterFromImdb(mappedIds.imdbId);
      }
    }
  }
  return fallbackPosterUrl;
}

/**
 * Get series background with art provider preference
 */
async function getSeriesBackground({ tmdbId, tvdbId, imdbId, metaProvider, fallbackBackgroundUrl }, config) {
  const artProvider = resolveArtProvider('series', 'background', config);
  
  if (artProvider === 'tvdb' && metaProvider != 'tvdb') {
    try {
      if(tvdbId) {
      const tvdbBackground = await tvdb.getSeriesBackground(tvdbId, config);
      if (tvdbBackground) {
        console.log(`[getSeriesBackground] Found TVDB background for series (TVDB ID: ${tvdbId})`);
          return tvdbBackground;
        }
      }
      else {
        if(!tmdbId) return fallbackBackgroundUrl;
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'series', config, null, ['tvdb']);
        if(mappedIds.tvdbId) {
          const tvdbBackground = await tvdb.getSeriesBackground(mappedIds.tvdbId, config);
          console.log(`[getSeriesBackground] Found TVDB background via ID mapping for series (TMDB ID: ${tmdbId} → TVDB ID: ${mappedIds.tvdbId})`);
          return tvdbBackground;
        }
      }
    } catch (error) {
      console.warn(`[getSeriesBackground] TVDB background fetch failed for series (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'fanart') {
    try {
      if(tvdbId) {
        const images = await fanart.getShowImages(tvdbId, config);
        const bg = selectFanartImageByLang(images?.showbackground, config);
        if (bg) {
          console.log(`[getSeriesBackground] Found Fanart.tv background for series (TVDB ID: ${tvdbId}, lang: ${bg.lang})`);
          return bg.url;
        }
      } else if(tmdbId) {
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'series', config);
        if(mappedIds.tvdbId) {
          const images = await fanart.getShowImages(mappedIds.tvdbId, config);
          const bg = selectFanartImageByLang(images?.showbackground, config);
          if (bg) {
            console.log(`[getSeriesBackground] Found Fanart.tv background via ID mapping for series (TMDB ID: ${tmdbId} → TVDB ID: ${mappedIds.tvdbId}, lang: ${bg.lang})`);
            return bg.url;
          }
        }
      }
          
    } catch (error) {
      console.warn(`[getSeriesBackground] Fanart.tv background fetch failed for series (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'tmdb' && metaProvider != 'tmdb') {
    try {
      if(tmdbId) {
        const tmdbBackground = await tmdb.tvImages({ id: tmdbId, include_image_language: null }, config).then(res => {
          const img = res.backdrops[0];
          return img?.file_path;
        });
        console.log(`[getSeriesBackground] Found TMDB background for series (TMDB ID: ${tmdbId})`);
        return `https://image.tmdb.org/t/p/original${tmdbBackground}`;
      }
      else {
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'series', config, null, ['tmdb']);
        if(mappedIds.tmdbId) {
          const tmdbBackground = await tmdb.tvImages({ id: mappedIds.tmdbId, include_image_language: null }, config).then(res => {
            const img = res.backdrops[0];
            return img?.file_path;
          });
          console.log(`[getSeriesBackground] Found TMDB background via ID mapping for series (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId})`);
          return `https://image.tmdb.org/t/p/original${tmdbBackground}`;
        }
      }
    } catch (error) {
      console.warn(`[getSeriesBackground] TMDB ID mapping failed for series (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  else if (artProvider === 'imdb' && metaProvider != 'imdb') {
    if(imdbId) {
      return imdb.getBackgroundFromImdb(imdbId);
    }
  }
  // Fallback to meta background
  return fallbackBackgroundUrl;
}

/**
 * Get series logo with art provider preference
 */
async function getSeriesLogo({ tmdbId, tvdbId, imdbId, metaProvider, fallbackLogoUrl }, config) {
  const artProvider = resolveArtProvider('series', 'logo', config);
  
  if (artProvider === 'tvdb' && metaProvider != 'tvdb') {
    try {
      if(tvdbId) {
        const tvdbLogo = await tvdb.getSeriesLogo(tvdbId, config);
        if (tvdbLogo) {
        console.log(`[getSeriesLogo] Found TVDB logo for series (TVDB ID: ${tvdbId})`);
          return tvdbLogo;
        }
      }
      else {
        if(!tmdbId) return fallbackLogoUrl;
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'series', config, null, ['tvdb']);
        if(mappedIds.tvdbId) {
          const tvdbLogo = await tvdb.getSeriesLogo(mappedIds.tvdbId, config);
          console.log(`[getSeriesLogo] Found TVDB logo via ID mapping for series (TMDB ID: ${tmdbId} → TVDB ID: ${mappedIds.tvdbId})`);
          return tvdbLogo;
        }
      }
    } catch (error) {
      console.warn(`[getSeriesLogo] TVDB logo fetch failed for series (TVDB ID: ${tvdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'fanart') {
    try {
      if(tvdbId) {
        const images = await fanart.getShowImages(tvdbId, config);
        const logo = selectFanartImageByLang(images?.hdtvlogo, config);
        if (logo) {
          //console.log(`[getSeriesLogo] Found Fanart.tv logo for series (TVDB ID: ${tvdbId}, lang: ${logo.lang})`);
          return logo.url;
        }
      }
      else if(tmdbId) {
        const mappedIds = await resolveAllIds(`tmdb:${tmdbId}`, 'series', config, null, ['tvdb']);
        if(mappedIds.tvdbId) {
          console.log(`[getSeriesLogo] Fetching Fanart.tv logo for series (TMDB ID: ${tmdbId} → TVDB ID: ${mappedIds.tvdbId})`);
          const images = await fanart.getShowImages(mappedIds.tvdbId, config);
          const logo = selectFanartImageByLang(images?.hdtvlogo, config);
          if (logo) {
            //console.log(`[getSeriesLogo] Found Fanart.tv logo for series (TVDB ID: ${tvdbId}, lang: ${logo.lang})`);
            return logo.url;
          }
        }
      }
      else {
        return fallbackLogoUrl;
      }
    } catch (error) {
      console.warn(`[getSeriesLogo] Fanart.tv logo fetch failed for series (TMDB ID: ${tmdbId}):`, error.message);
    }
  }
  
  if (artProvider === 'tmdb') {
    try {
      if(tmdbId) {
        const tmdbLogo = await tmdb.tvImages({ id: tmdbId }, config).then(res => {
          const img = selectTmdbImageByLang(res.logos, config);
          return img?.file_path;
        });
        if (tmdbLogo) {
          console.log(`[getSeriesLogo] Found TMDB logo for series (TMDB ID: ${tmdbId})`);
          return `https://image.tmdb.org/t/p/original${tmdbLogo}`;
        }
      }
      else {
        if(!tvdbId) return fallbackLogoUrl;
        const mappedIds = await resolveAllIds(`tvdb:${tvdbId}`, 'series', config);
        if(mappedIds.tmdbId) {
          const tmdbLogo = await tmdb.tvImages({ id: mappedIds.tmdbId }, config).then(res => {
            const img = selectTmdbImageByLang(res.logos, config);
            return img?.file_path;
          });
          if (tmdbLogo) {
            console.log(`[getSeriesLogo] Found TMDB logo via ID mapping for series (TVDB ID: ${tvdbId} → TMDB ID: ${mappedIds.tmdbId})`);
            return `https://image.tmdb.org/t/p/original${tmdbLogo}`;
          }
        }
      }
    } catch (error) {
      console.warn(`[getSeriesLogo] TMDB logo fetch failed for series (TMDB ID: ${tmdbId}):`, error.message);
    }
  }
  else if ((artProvider === 'imdb' || fallbackLogoUrl === null) && metaProvider != 'imdb') {
    if(imdbId) {
      return imdb.getLogoFromImdb(imdbId);
    }
  }
  return fallbackLogoUrl;

}

/**
 * Convert banner image to background image using the image processing API
 * @param {string} bannerUrl - Original banner image URL
 * @param {Object} options - Processing options
 * @param {number} options.width - Target width (default: 1920)
 * @param {number} options.height - Target height (default: 1080)
 * @param {number} options.blur - Blur amount (default: 0)
 * @param {number} options.brightness - Brightness adjustment (default: 1)
 * @param {number} options.contrast - Contrast adjustment (default: 1)
 * @param {boolean} options.addGradient - Whether to add gradient overlay (default: false)
 * @param {string} options.gradientType - Gradient type: 'dark' or 'light' (default: 'dark')
 * @param {number} options.gradientOpacity - Gradient opacity 0-1 (default: 0.6)
 * @returns {string} Processed background image URL
 */
function convertBannerToBackgroundUrl(bannerUrl, options = {}) {
  if (!bannerUrl) return null;
  
  const {
    width = 1920,
    height = 1080,
    blur = 0,
    brightness = 1,
    contrast = 1,
    addGradient = false,
    gradientType = 'dark',
    gradientOpacity = 0.6
  } = options;

  const host = process.env.HOST_NAME.startsWith('http')
    ? process.env.HOST_NAME
    : `https://${process.env.HOST_NAME}`;

  // Build the query parameters
  const params = new URLSearchParams({
    url: bannerUrl,
    width: width.toString(),
    height: height.toString(),
    blur: blur.toString(),
    brightness: brightness.toString(),
    contrast: contrast.toString()
  });

  let endpoint = '/api/image/banner-to-background';
  
  // If gradient is requested, use the gradient overlay endpoint
  if (addGradient) {
    endpoint = '/api/image/gradient-overlay';
    params.delete('width', 'height', 'blur', 'brightness', 'contrast');
    params.set('gradient', gradientType);
    params.set('opacity', gradientOpacity.toString());
  }

  return `${host}${endpoint}?${params.toString()}`;
}

/**
 * Smart background image processor that automatically converts banners to backgrounds
 * @param {string} imageUrl - Original image URL
 * @param {string} imageType - Type of image: 'banner', 'poster', 'background'
 * @param {Object} options - Processing options
 * @returns {string} Processed image URL
 */
function processBackgroundImage(imageUrl, imageType = 'background', options = {}) {
  if (!imageUrl) return null;

  // If it's already a background image, return as is
  if (imageType === 'background') {
    return imageUrl;
  }

  // If it's a banner, convert to background
  if (imageType === 'banner') {
    return convertBannerToBackgroundUrl(imageUrl, {
      blur: 2, // Slight blur for better text readability
      brightness: 0.9, // Slightly darker
      addGradient: true, // Add dark gradient overlay
      gradientOpacity: 0.5,
      ...options
    });
  }

  // If it's a poster, convert to background with more processing
  if (imageType === 'poster') {
    return convertBannerToBackgroundUrl(imageUrl, {
      blur: 3, // More blur for posters
      brightness: 0.8, // Darker for better contrast
      addGradient: true,
      gradientOpacity: 0.6,
      ...options
    });
  }

  return imageUrl;
}

/**
 * Convert AniList banner image to background image
 * @param {string} bannerUrl - AniList banner image URL
 * @param {Object} options - Processing options
 * @returns {string} Processed background image URL
 */
function convertAnilistBannerToBackground(bannerUrl, options = {}) {
  if (!bannerUrl) return null;
  
  return convertBannerToBackgroundUrl(bannerUrl, {
    width: 1920,
    height: 1080,
    blur: 0.5, // Minimal blur to preserve image quality
    brightness: 0.98, // Keep original brightness
    contrast: 1.05, // Very slight contrast boost
    ...options
  });
}

// Helper for language fallback selection from TMDB images
function selectTmdbImageByLang(images, config, key = 'iso_639_1') {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  
  // If englishArtOnly is enabled, force English language selection
  const targetLang = config.artProviders?.englishArtOnly ? 'en' : (config.language?.split('-')[0]?.toLowerCase() || 'en');
  
  // Sort by vote_average descending
  const sorted = images.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  return (
    sorted.find(img => img[key] === targetLang) ||
    sorted.find(img => img[key] === 'en') ||
    sorted[0]
  );
}

module.exports = {
  parseMedia,
  parseCast,
  parseDirector,
  parseWriter,
  parseSlug,
  parseTrailers,
  parseTrailerStream,
  parseImdbLink,
  parseShareLink,
  parseGenreLink,
  parseCreditsLink,
  buildLinks,
  parseCoutry,
  parseGenres,
  parseYear,
  parseRunTime,
  parseCreatedBy,
  parseConfig,
  parsePoster,
  getRpdbPoster,
  checkIfExists,
  sortSearchResults,
  parseAnimeCreditsLink,
  getAnimeBg,
  parseAnimeCatalogMeta,
  parseAnimeCatalogMetaBatch,
  parseTvdbTrailers,
  parseAnimeRelationsLink,
  parseAnimeGenreLink,
  getAnimePoster,
  getAnimeLogo,
  getBatchAnimeArtwork,
  getMoviePoster,
  getMovieBackground,
  getMovieLogo,
  getSeriesPoster,
  getSeriesBackground,
  getSeriesLogo,
  selectTmdbImageByLang,
  processBackgroundImage,
  convertAnilistBannerToBackground,
  getTmdbMovieCertificationForCountry,
  getTmdbTvCertificationForCountry,
  resolveArtProvider,
  addMetaProviderAttribution
};
