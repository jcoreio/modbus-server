/* eslint-disable  @typescript-eslint/explicit-function-return-type */

async function getNPMToken(env = process.env) {
  const { NPM_TOKEN } = env
  if (NPM_TOKEN) return NPM_TOKEN
  try {
    const homedir = require('os').homedir()
    const npmrc = await require('fs-extra').readFile(`${homedir}/.npmrc`)
    const match = /:_authToken=([a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})/.exec(
      npmrc
    )
    if (match) return match[1]
  } catch (error) {
    // ignore
  }
  throw new Error('Missing process.env.NPM_TOKEN or entry in ~/.npmrc')
}

module.exports = { getNPMToken }