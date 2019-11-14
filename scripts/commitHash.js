/* eslint-disable  @typescript-eslint/no-var-requires,  @typescript-eslint/explicit-function-return-type */

const { exec } = require('promisify-child-process')

async function getCommitHash() {
  return (await exec('git rev-parse HEAD')).stdout.trim()
}

module.exports = { getCommitHash }
