const { exec } = require('promisify-child-process')

async function getCommitHash() {
  return (await exec('git rev-parse HEAD')).stdout.trim()
}

module.exports = { getCommitHash }
