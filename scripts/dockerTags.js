// @flow
/* eslint-disable flowtype/require-return-type, flowtype/require-parameter-type */

const { getCommitHash } = require('./commitHash')
const { dockerTagBase } = require('./config')

async function getDockerTags() /* : Promise<{base: string, latest: string, commitHash: string}> */ {
  const commitHash = await getCommitHash()
  return {
    base: dockerTagBase,
    latest: `${dockerTagBase}:latest`,
    commitHash: `${dockerTagBase}:${commitHash}`,
  }
}

module.exports = { getDockerTags }
