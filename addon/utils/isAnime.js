
/**
 * A robust function to determine if a media item is an anime.
 * It checks for specific genres and prioritizes Japanese origin.
 * @param {object} mediaObject - The raw media object from TMDB or a TVDB record.
 * @param {Array<object>} genreList - A lookup list of genres [{id: 16, name: 'Animation'}, ...], required for TMDB results.
 * @returns {boolean} - True if the item is likely an anime.
 */
function isAnime(mediaObject, genreList = []) {
  if (!mediaObject) {
    return false;
  }

  let genreNames = new Set();
  
  if (Array.isArray(mediaObject.genres)) {
    mediaObject.genres.forEach(g => genreNames.add(g.name.toLowerCase()));
  } 
  else if (Array.isArray(mediaObject.genre_ids)) {
    mediaObject.genre_ids.forEach(id => {
      const genre = genreList.find(g => g.id === id);
      if (genre && genre.name) {
        genreNames.add(genre.name.toLowerCase());
      }
    });
  }

  const hasAnimationGenre = genreNames.has('animation');
  const hasAnimeGenre = genreNames.has('anime');

  if (!hasAnimationGenre && !hasAnimeGenre) {
    return false;
  }

  const originalLanguage = mediaObject.original_language || mediaObject.originalLanguage;
  const originalCountry = mediaObject.originalCountry; 
  
  if ((originalLanguage === 'ja' || originalCountry === 'jp' || originalCountry === 'jpn') && (hasAnimeGenre || hasAnimationGenre)) {
    return true;
  }

  if (hasAnimeGenre) {
    return true;
  }
  return false;
}

module.exports = { isAnime };
