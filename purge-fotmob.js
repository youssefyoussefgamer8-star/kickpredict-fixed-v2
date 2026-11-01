'use strict';
const { nuclearPurgeFotmob } = require('./nuclear-purge-fotmob');

if (require.main === module) {
  nuclearPurgeFotmob();
}

module.exports = { purgeFotmobAndResync: nuclearPurgeFotmob };
