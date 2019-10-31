// @flow
/* eslint-disable flowtype/require-return-type, flowtype/require-parameter-type */

const getCommitHash = require('./getCommitHash')
const { dockerTagBase } = require('./config')

async function getDockerTags(
  target /* :? string */
) /* : Promise<{latest: string, commitHash: string}> */ {
  const commitHash = await getCommitHash()
  return {
    base: dockerTagBase,
    latest: `${dockerTagBase}:latest`,
    commitHash: `${dockerTagBase}:${commitHash}`,
  }
}

module.exports = getDockerTags
