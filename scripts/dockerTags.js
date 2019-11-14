// @flow

/* eslint-disable  @typescript-eslint/no-var-requires, @typescript-eslint/explicit-function-return-type */

const { getCommitHash } = require('./commitHash')
const { dockerTagBase } = require('./config')

async function getDockerTags() {
  const commitHash = await getCommitHash()
  return {
    base: dockerTagBase,
    latest: `${dockerTagBase}:latest`,
    commitHash: `${dockerTagBase}:${commitHash}`,
  }
}

module.exports = { getDockerTags }
