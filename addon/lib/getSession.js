require("dotenv").config();
const axios = require("axios")

async function getRequestToken(config) {
    const key =config.apiKeys?.tmdb || process.env.TMDB_API;
    return axios.get(`https://api.themoviedb.org/3/authentication/token/new?api_key=${key}`)
        .then(response => {
            if (response.data.success) {
                return response.data.request_token
            }
        })
}

async function getSessionId(requestToken, config) {
    const key =config.apiKeys?.tmdb || process.env.TMDB_API;
    return axios.get(`https://api.themoviedb.org/3/authentication/session/new?api_key=${key}&request_token=${requestToken}`)
        .then(response => {
            if (response.data.success) {
                return response.data.session_id
            }
        })
}

module.exports = { getRequestToken, getSessionId }