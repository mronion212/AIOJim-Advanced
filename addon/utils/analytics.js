require('dotenv').config();
const swaggerStats = require('swagger-stats');
const packageJson = require("../../package.json");

class Analytics {
  static instance;
  constructor() {
    if (!Analytics.instance) {
      this.middleware = swaggerStats.getMiddleware({
        name: packageJson.name,
        version: packageJson.version,
        timelineBucketDuration: 60000,
        uriPath: '/stats/ui',
        authentication: true,
        onAuthenticate: (req, username, password) =>
          username === process.env.METRICS_USER &&
          password === process.env.METRICS_PASSWORD,
        swaggerSpec: {
          info: {
            title: 'TMDB Addon API',
            version: packageJson.version
          }
        }
      });

      Analytics.instance = this;
    }

    return Analytics.instance;
  }
}

module.exports = new Analytics();

