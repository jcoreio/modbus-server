#!/usr/bin/env node

/* eslint-disable no-console */

const chalk = require('chalk')
const { VError } = require('verror')

const requireEnv = require('@jcoreio/require-env')
const { exec, spawn } = require('@jcoreio/script-tools')

const { doECRLogin, getECRHost } = require('./ecr')
const { getDockerTags } = require('./dockerTags')

async function dockerPush() {
  require('dotenv').config()
  const AWSAccountId = requireEnv('AWS_ACCOUNT_ID')
  const AWSRegion = requireEnv('AWS_REGION')

  const ecrHost = getECRHost({ AWSAccountId, AWSRegion })

  await doECRLogin()

  const {
    base: baseTag,
    commitHash: commitHashTag,
    latest: latestTag,
  } = await getDockerTags()
  await exec(`docker tag "${commitHashTag}" "${ecrHost}/${commitHashTag}"`)
  await exec(`docker tag "${commitHashTag}" "${ecrHost}/${latestTag}"`).catch(
    () => exec(`docker tag -f "${commitHashTag}" "${ecrHost}/${commitHashTag}"`)
  )
  const doPush = tag =>
    spawn('docker', ['push', `${ecrHost}/${tag}`], { captureStdio: true })
  try {
    await doPush(commitHashTag)
  } catch (err) {
    const { stderr } = err
    if (
      stderr &&
      stderr.startsWith(
        `name unknown: The repository with name '${baseTag}' does not exist in the registry`
      )
    ) {
      console.log(
        chalk.green(`ECR repository ${baseTag} does not exist. Creating it...`)
      )
      await exec(`aws ecr create-repository --repository-name ${baseTag}`)
      await doPush(commitHashTag)
    } else {
      throw new VError(err, 'could not push to docker repository')
    }
  }
  await doPush(latestTag)
  console.log(
    chalk.green(
      `successfully pushed tag ${commitHashTag} to the ECR repository`
    )
  )
}

module.exports = { dockerPush }
